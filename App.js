import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Alert,
  ScrollView,
  Modal,
  TextInput,
  Animated,
  BackHandler,
} from 'react-native';
import Slider from '@react-native-community/slider';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import { RussoOne_400Regular } from '@expo-google-fonts/russo-one';

// Наборы символов
const SETS = {
  lower: { label: 'Буквы', chars: 'abcdefghijklmnopqrstuvwxyz' },
  upper: { label: 'Заглавные', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  digits: { label: 'Цифры', chars: '0123456789' },
  symbols: { label: 'Символы', chars: '!@#$%^&*()_+-=[]{};:,.<>?' },
};

const STORAGE_KEY = 'password_history';

// Безопасная генерация: возвращает целое число [0, max)
// Используем «rejection sampling»: выбрасываем случайные числа, которые могли бы
// создать неравномерность (например, 2^32 не делится на 26 нацело, значит «остатки»
// дали бы буквам A–F чуть больше шансов). Пока не выпало подходящее — берём новое.
function randomInt(max) {
  const buf = new Uint32Array(1);
  // Наибольшее значение, кратное max и не превышающее 2^32 — при нём деление честное.
  const limit = Math.floor(0xffffffff / max) * max;
  let value;
  do {
    Crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % max;
}

export default function App() {
  const [length, setLength] = useState(12);
  const [enabled, setEnabled] = useState({ lower: true, upper: true, digits: true, symbols: true });
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  // Техно-шрифт Russo One: заголовок и подписи рисуются на нём, когда шрифт готов
  const [fontsLoaded] = useFonts({ RussoOne_400Regular });

  // История скопированных паролей
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null); // запись, для которой открыто меню «⋯»
  const [confirmItem, setConfirmItem] = useState(null); // запись, для которой открыто подтверждение удаления
  const [noteTarget, setNoteTarget] = useState(null); // запись, для которой открыт просмотр заметки
  const [editTarget, setEditTarget] = useState(null); // запись, для которой открыто редактирование заметки
  const [noteDraft, setNoteDraft] = useState(''); // черновик текста заметки

  // Переключение экранов: 'main' — генерация, 'saved' — список сохранённых паролей
  const [screen, setScreen] = useState('main');
  const [clearConfirm, setClearConfirm] = useState(false); // подтверждение «Очистить всё»

  // Плавный переход «слайд вбок»: 0 — главный экран на месте, 1 — список на месте
  const slide = useRef(new Animated.Value(0)).current;

  function switchScreen(next) {
    if (screen === next) return;
    setScreen(next); // запоминаем активный экран для логики
    Animated.timing(slide, {
      toValue: next === 'saved' ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }

  // Системная кнопка «назад» на Android: со второго экрана — возврат на главный,
  // с главного — обычный выход из приложения.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'saved') {
        switchScreen('main');
        return true; // нажатие обработано — приложение остаётся открытым
      }
      return false; // на главном экране — пусть приложение закрывается как обычно
    });
    return () => sub.remove();
  }, [screen]);

  // Загрузка истории при старте
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) setHistory(JSON.parse(raw));
      } catch (e) {
        // повреждённые данные игнорируем
      }
    })();
  }, []);

  // Сохранение истории при каждом изменении
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(history)).catch(() => {});
  }, [history]);

  // Сортировка: сначала закреплённые, затем по дате (новые выше)
  function sortHistory(list) {
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }

  function generate() {
    const active = Object.entries(SETS)
      .filter(([key]) => enabled[key])
      .map(([, s]) => s.chars);

    // Нужно хотя бы один набор символов
    if (active.length === 0) {
      Alert.alert('Выберите набор символов', 'Включите хотя бы один тип символов');
      return;
    }

    const pool = active.join('');
    let result = '';
    // Гарантируем хотя бы один символ из каждого выбранного набора
    for (const chars of active) result += chars[randomInt(chars.length)];
    // Добираем остаток
    while (result.length < length) result += pool[randomInt(pool.length)];
    // Перемешиваем (Fisher–Yates)
    const arr = result.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    setPassword(arr.join(''));
    setCopied(false);
  }

  // Добавить пароль в историю (без дубликатов)
  function addToHistory(text) {
    setHistory(prev => {
      const existing = prev.find(item => item.text === text);
      if (existing) {
        // Тот же пароль уже есть — обновляем дату, поднимаем наверх, pinned сохраняем
        return sortHistory(
          prev.map(item => (item.text === text ? { ...item, createdAt: Date.now() } : item))
        );
      }
      return sortHistory([{ id: Date.now(), text, pinned: false, createdAt: Date.now(), note: '' }, ...prev]);
    });
  }

  async function copy() {
    if (!password) return;
    await Clipboard.setStringAsync(password);
    addToHistory(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function copyFromHistory(item) {
    await Clipboard.setStringAsync(item.text);
    addToHistory(item.text);
    setSelected(null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function togglePin(item) {
    setHistory(prev =>
      sortHistory(prev.map(i => (i.id === item.id ? { ...i, pinned: !i.pinned } : i)))
    );
    setSelected(null);
  }

  function confirmDelete(item) {
    setSelected(null);
    setConfirmItem(item);
  }

  function performDelete() {
    if (confirmItem) {
      setHistory(prev => prev.filter(i => i.id !== confirmItem.id));
    }
    setConfirmItem(null);
  }

  // Открыть редактирование заметки (из меню «⋯»)
  function openNoteEdit(item) {
    setSelected(null);
    setEditTarget(item);
    setNoteDraft(item.note || '');
  }

  function saveNote() {
    if (!editTarget) return;
    setHistory(prev =>
      prev.map(i => (i.id === editTarget.id ? { ...i, note: noteDraft.trim() } : i))
    );
    setEditTarget(null);
    setNoteDraft('');
  }

  function clearNote() {
    if (!editTarget) return;
    setHistory(prev =>
      prev.map(i => (i.id === editTarget.id ? { ...i, note: '' } : i))
    );
    setEditTarget(null);
    setNoteDraft('');
  }

  function toggle(key) {
    setEnabled(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.screen}>
      <Animated.View
        style={[
          styles.stage,
          {
            transform: [
              { translateX: slide.interpolate({ inputRange: [0, 1], outputRange: ['0%', '-50%'] }) },
            ],
          },
        ]}
      >
      <View style={styles.stagePart}>
      {/* Заголовок на техно-шрифте: пока Russo One не загружен — тонкий placeholder,
      а когда готов — рисуем заголовок целиком на новом шрифте (надёжнее, чем менять шрифт на лету) */}
      {fontsLoaded ? (
        <Text id="app-title" style={styles.title}>Генератор паролей</Text>
      ) : (
        <Text style={styles.titleWait}>⟳ загрузка шрифта...</Text>
      )}

      {/* Отображение пароля */}
      <TouchableOpacity style={styles.passwordBox} onPress={copy} activeOpacity={0.8}>
        {password ? (
          <Text style={styles.password} selectable>{password}</Text>
        ) : (
          <Text style={styles.passwordHint}>Нажмите «Сгенерировать»</Text>
        )}
      </TouchableOpacity>

      <Text style={[styles.copied, { opacity: copied ? 1 : 0 }]}>Пароль сохранен!</Text>

      {/* Длина */}
      <Text style={styles.section}>Длина: {length} символов</Text>
      <Slider
        style={styles.slider}
        minimumValue={4}
        maximumValue={64}
        step={1}
        value={length}
        onValueChange={setLength}
        minimumTrackTintColor="#7C6CF0"
        maximumTrackTintColor="#3a3a4a"
        thumbTintColor="#7C6CF0"
      />

      {/* Наборы символов — 2×2 сетка */}
      <Text style={styles.section}>Сложность</Text>
      <View style={styles.toggles}>
        {Object.entries(SETS).map(([key, s]) => (
          <TouchableOpacity
            key={key}
            style={[styles.chip, enabled[key] && styles.chipActive]}
            onPress={() => toggle(key)}
          >
            <Text style={[styles.chipText, enabled[key] && styles.chipTextActive]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Кнопки действий — по одной на всю ширину */}
      <View style={styles.buttons}>
        <TouchableOpacity style={styles.btnGenerate} onPress={generate}>
          <Text style={styles.btnGenerateText}>Сгенерировать</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btnCopy, !password && styles.btnCopyDisabled]}
          onPress={copy}
          disabled={!password}
        >
          <Text style={[styles.btnCopyText, !password && styles.btnCopyTextDisabled]}>
            Копировать
          </Text>
        </TouchableOpacity>
      </View>

      {/* Переход к сохранённым паролям */}
      <TouchableOpacity style={styles.btnLibrary} onPress={() => switchScreen('saved')}>
        <Text style={styles.btnLibraryText}>
          Сохранённые ({history.length})
        </Text>
      </TouchableOpacity>
      </View>
      <View style={styles.stagePart}>
      {/* Экран: сохранённые пароли */}
      <View style={styles.libraryHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={() => switchScreen('main')}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Сохранённые пароли</Text>
        {history.length > 0 ? (
          <TouchableOpacity style={styles.clearBtn} onPress={() => setClearConfirm(true)}>
            <Text style={styles.clearBtnText}>🗑</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.clearBtnPlaceholder} />
        )}
      </View>

      <Text style={styles.section}>Паролей: {history.length}</Text>

      {history.length === 0 ? (
        <>
          <Text style={styles.historyEmpty}>Сохранённых паролей пока нет</Text>
          <TouchableOpacity style={styles.btnLibrary} onPress={() => switchScreen('main')}>
            <Text style={styles.btnLibraryText}>На главную</Text>
          </TouchableOpacity>
        </>
      ) : (
        <ScrollView
          style={styles.historyList}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {history.map(item => (
            <View
              key={item.id}
              style={[styles.historyItem, item.pinned && styles.historyItemPinned]}
            >
              <Text style={styles.historyText} numberOfLines={2}>
                {item.pinned ? '📌 ' : ''}{item.text}
              </Text>
              {item.pinned && !!item.note && (
                <TouchableOpacity style={styles.noteBtn} onPress={() => setNoteTarget(item)}>
                  <Text style={styles.noteBtnText}>📝</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.moreBtn} onPress={() => setSelected(item)}>
                <Text style={styles.moreBtnText}>⋮</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
        </View>
        </Animated.View>
      </View>

      {/* Меню действий «⋯» */}
      <Modal
        visible={selected !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          <View style={styles.modalSheet}>
            {selected && (
              <>
                <Text style={styles.modalTitle}>{selected.pinned ? 'Закреплён' : 'Действия'}</Text>
                {selected.pinned && (
                  <TouchableOpacity style={styles.modalOption} onPress={() => openNoteEdit(selected)}>
                    <Text style={styles.modalOptionText}>
                      {selected.note ? 'Изменить заметку' : 'Добавить заметку'}
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.modalOption} onPress={() => togglePin(selected)}>
                  <Text style={styles.modalOptionText}>
                    {selected.pinned ? 'Открепить' : 'Закрепить'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalOption} onPress={() => copyFromHistory(selected)}>
                  <Text style={styles.modalOptionText}>Скопировать</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalOption} onPress={() => confirmDelete(selected)}>
                  <Text style={[styles.modalOptionText, styles.modalOptionDanger]}>Удалить</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalOption} onPress={() => setSelected(null)}>
                  <Text style={styles.modalOptionText}>Отмена</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Окно подтверждения удаления */}
      <Modal
        visible={confirmItem !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmItem(null)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            {confirmItem && (
              <>
                <Text style={styles.confirmTitle}>Удалить пароль?</Text>
                <Text style={styles.confirmText} numberOfLines={2}>{confirmItem.text}</Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmBtnCancel]}
                    onPress={() => setConfirmItem(null)}
                  >
                    <Text style={styles.confirmBtnCancelText}>Отмена</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmBtnDelete]}
                    onPress={performDelete}
                  >
                    <Text style={styles.confirmBtnDeleteText}>Удалить</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Окно подтверждения очистки всех паролей */}
      <Modal
        visible={clearConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setClearConfirm(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            <Text style={styles.confirmTitle}>Удалить все пароли?</Text>
            <Text style={styles.confirmText}>
              Будут удалены все {history.length} сохранённых паролей. Это действие нельзя отменить.
            </Text>
            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnCancel]}
                onPress={() => setClearConfirm(false)}
              >
                <Text style={styles.confirmBtnCancelText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnDelete]}
                onPress={() => { setHistory([]); setClearConfirm(false); }}
              >
                <Text style={styles.confirmBtnDeleteText}>Удалить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Окно просмотра заметки */}
      <Modal
        visible={noteTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setNoteTarget(null)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            {noteTarget && (
              <>
                <Text style={styles.confirmTitle}>Заметка</Text>
                <Text style={styles.viewNoteText}>{noteTarget.note}</Text>
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmBtnCancel]}
                    onPress={() => { setEditTarget(noteTarget); setNoteDraft(noteTarget.note || ''); setNoteTarget(null); }}
                  >
                    <Text style={styles.confirmBtnCancelText}>Изменить</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmBtnDelete]}
                    onPress={() => setNoteTarget(null)}
                  >
                    <Text style={styles.confirmBtnDeleteText}>Закрыть</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Окно редактирования заметки */}
      <Modal
        visible={editTarget !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { setEditTarget(null); setNoteDraft(''); }}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmBox}>
            {editTarget && (
              <>
                <Text style={styles.confirmTitle}>Заметка</Text>
                <TextInput
                  style={styles.editNoteInput}
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder="Введите заметку..."
                  placeholderTextColor="#666"
                  multiline
                  textAlignVertical="top"
                />
                <View style={styles.confirmButtons}>
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmBtnCancel]}
                    onPress={() => { setEditTarget(null); setNoteDraft(''); }}
                  >
                    <Text style={styles.confirmBtnCancelText}>Отмена</Text>
                  </TouchableOpacity>
                  {editTarget.note ? (
                    <TouchableOpacity
                      style={[styles.confirmBtn, styles.confirmBtnGold]}
                      onPress={clearNote}
                    >
                      <Text style={styles.confirmBtnGoldText}>Удалить</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    style={[styles.confirmBtn, styles.confirmBtnDelete]}
                    onPress={saveNote}
                  >
                    <Text style={styles.confirmBtnDeleteText}>Сохранить</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#14141d',
  },
  screen: {
    flex: 1,
    overflow: 'hidden',
  },
  stage: {
    flexDirection: 'row',
    flex: 1,
    width: '200%',
  },
  stagePart: {
    width: '50%',
    paddingTop: 80,
    paddingHorizontal: 24,
  },
  title: {
    color: '#ff6b6b',
    fontSize: 22,
    textAlign: 'center',
    width: '100%',
    marginBottom: 24,
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
    textShadowColor: 'rgba(255, 100, 100, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
  },
  // Заглушка, видимая короткий миг, пока шрифт Russo One загружается
  titleWait: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    width: '100%',
    marginBottom: 24,
  },
  passwordBox: {
    backgroundColor: '#1e1e2b',
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 20,
    height: 150, // фиксированная высота: вмещает пароль до 64 символов (~3 строки), поле не «скачет»
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2e2e3e',
  },
  password: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.5,
    flexWrap: 'wrap',
    width: '100%',
    overflowWrap: 'break-word',
    wordBreak: 'break-word',
  },
  // Подсказка в пустом поле генерации — на техно-шрифте, чтобы смотрелась как приглашение.
  passwordHint: {
    color: '#555',
    fontSize: 15,
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 1,
  },
  hint: {
    color: '#666',
    fontSize: 12,
    marginTop: 8,
  },
  // Надпись «Пароль сохранен!» — Russo One (символ ✓ убран, обрезки не будет).
  copied: {
    color: '#4ade80',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    fontWeight: '600',
    fontFamily: 'RussoOne_400Regular',
  },
  section: {
    color: '#999',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 24,
    marginBottom: 8,
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
  },
  slider: {
    width: '100%',
    height: 40,
  },
  toggles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  chip: {
    width: '48%',
    backgroundColor: '#1e1e2b',
    borderWidth: 1,
    borderColor: '#3a3a4a',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: '#7C6CF0',
    borderColor: '#7C6CF0',
  },
  // Единый шрифт интерфейса: плитки наборов тоже на Russo One (все символы в шрифте есть,
  // эмодзи из текста убраны — обрезки не будет).
  chipText: {
    color: '#999',
    fontSize: 12,
    fontFamily: 'RussoOne_400Regular',
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '600',
  },
  buttons: {
    flexDirection: 'column',
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
  },
  btnGenerate: {
    backgroundColor: '#14b8a6',
    borderRadius: 18,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    elevation: 4,
  },
  btnGenerateText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
  },
  btnCopy: {
    backgroundColor: '#1a2a3a',
    borderWidth: 1,
    borderColor: '#2a4a6a',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  // Кнопка «Копировать» — Russo One в общем стиле (текст без эмодзи, символы все есть).
  btnCopyText: {
    color: '#60a5fa',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
  },
  btnCopyDisabled: {
    backgroundColor: '#171722',
    borderColor: '#262633',
  },
  btnCopyTextDisabled: {
    color: '#4a4a58',
  },
  btnLibrary: {
    backgroundColor: '#2a2150',
    borderWidth: 1,
    borderColor: '#7C6CF0',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginTop: 12,
  },
  btnLibraryText: {
    color: '#c4b5fd',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
  },
  libraryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  backBtn: {
    paddingVertical: 8,
    paddingRight: 12,
  },
  backBtnText: {
    color: '#c4b5fd',
    fontSize: 30,
    fontWeight: '900',
  },
  headerTitle: {
    flex: 1,
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
  },
  clearBtn: {
    paddingVertical: 8,
    paddingLeft: 12,
  },
  clearBtnText: {
    fontSize: 18,
  },
  clearBtnPlaceholder: {
    width: 38,
  },
  historyEmpty: {
    color: '#666',
    fontSize: 13,
    marginBottom: 20,
  },
  historyList: {
    flex: 1,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1e1e2b',
    borderWidth: 1,
    borderColor: '#2e2e3e',
    borderRadius: 12,
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 6,
    marginBottom: 8,
  },
  historyItemPinned: {
    borderColor: '#7C6CF0',
    backgroundColor: '#211c35',
  },
  historyText: {
    color: '#ddd',
    fontSize: 14,
    fontFamily: 'monospace',
    flex: 1,
    marginRight: 8,
  },
  moreBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  moreBtnText: {
    color: '#999',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#1e1e2b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 30,
    paddingHorizontal: 16,
  },
  modalTitle: {
    color: '#999',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 8,
    fontFamily: 'RussoOne_400Regular',
  },
  modalOption: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2e2e3e',
  },
  modalOptionText: {
    color: '#fff',
    fontSize: 16,
    textAlign: 'center',
    fontFamily: 'RussoOne_400Regular',
  },
  modalOptionDanger: {
    color: '#ef4444',
  },
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  confirmBox: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#1e1e2b',
    borderRadius: 20,
    padding: 20,
  },
  confirmTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 12,
    fontFamily: 'RussoOne_400Regular',
  },
  confirmText: {
    color: '#ccc',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginBottom: 20,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmBtnCancel: {
    backgroundColor: '#2a2a3a',
  },
  confirmBtnCancelText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    fontFamily: 'RussoOne_400Regular',
  },
  confirmBtnDelete: {
    backgroundColor: '#ef4444',
  },
  confirmBtnDeleteText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'RussoOne_400Regular',
  },
  // Значок «есть заметка» — просто эмодзи, как 📌 рядом с паролем
  noteBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  noteBtnText: {
    fontSize: 14,
  },
  // Текст заметки в окне просмотра — светлый, на контрастном поле
  viewNoteText: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 22,
    backgroundColor: '#2a2a3a',
    borderWidth: 1,
    borderColor: '#3a3a4a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 20,
  },
  // Поле ввода заметки — светлый текст, достаточно места, отступ от кнопок
  editNoteInput: {
    color: '#fff',
    fontSize: 15,
    backgroundColor: '#2a2a3a',
    borderWidth: 1,
    borderColor: '#3a3a4a',
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    marginBottom: 16,
  },
  confirmBtnGold: {
    backgroundColor: '#3a2f00',
  },
  confirmBtnGoldText: {
    color: '#fbbf24',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'RussoOne_400Regular',
  },
});