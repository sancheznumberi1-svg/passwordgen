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
import * as SecureStore from 'expo-secure-store';
import { useFonts } from 'expo-font';
import { RussoOne_400Regular } from '@expo-google-fonts/russo-one';
import { v4 as uuidv4 } from 'uuid';

// Наборы символов
const SETS = {
  upper: { label: 'ABC', chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
  lower: { label: 'abc', chars: 'abcdefghijklmnopqrstuvwxyz' },
  digits: { label: '123', chars: '0123456789' },
  symbols: { label: '!@#', chars: '!@#$%^&*()_+-=[]{};:,.<>?' },
};

const STORAGE_KEY = 'password_history_v1';
const MAX_HISTORY_ITEMS = 100;
const MAX_NOTE_LENGTH = 500;
const CLIPBOARD_TIMEOUT = 30000; // 30 сек — автоочистка буфера

// Безопасная генерация: возвращает целое число [0, max)
function randomInt(max) {
  const buf = new Uint32Array(1);
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
  const [passwordVisible, setPasswordVisible] = useState(true); // показывать ли пароль
  const [copied, setCopied] = useState(false);

  const [fontsLoaded] = useFonts({ RussoOne_400Regular });

  // Анимация свечения заголовка — с правильной очисткой
  const titleOpacity = useRef(new Animated.Value(1)).current;
  const animRef = useRef(null);

  useEffect(() => {
    animRef.current = Animated.loop(
      Animated.sequence([
        Animated.timing(titleOpacity, { toValue: 0.7, duration: 1100, useNativeDriver: true }),
        Animated.timing(titleOpacity, { toValue: 1, duration: 1100, useNativeDriver: true }),
      ])
    );
    animRef.current.start();

    return () => {
      // Остановим анимацию при размонтировании
      if (animRef.current) {
        animRef.current.stop();
      }
    };
  }, [titleOpacity]);

  // История скопированных паролей
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState(null);
  const [confirmItem, setConfirmItem] = useState(null);
  const [noteTarget, setNoteTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');

  const [screen, setScreen] = useState('main');
  const [clearConfirm, setClearConfirm] = useState(false);

  const slide = useRef(new Animated.Value(0)).current;

  // Ссылки на таймауты для очистки
  const timeoutRefs = useRef({});
  const clipboardTimeoutRef = useRef(null);

  function switchScreen(next) {
    if (screen === next) return;
    setScreen(next);
    Animated.timing(slide, {
      toValue: next === 'saved' ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }

  // BackHandler с правильной очисткой
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'saved') {
        switchScreen('main');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen]);

  // Загрузка истории при старте (из защищённого хранилища)
  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setHistory(parsed.slice(0, MAX_HISTORY_ITEMS));
          }
        }
      } catch (e) {
        console.warn('Failed to load password history:', e.message);
        // Если хранилище повреждено, начнём с пустого массива
        setHistory([]);
      }
    })();
  }, []);

  // Сохранение истории при каждом изменении (в защищённое хранилище)
  useEffect(() => {
    (async () => {
      try {
        // Ограничиваем размер: максимум MAX_HISTORY_ITEMS записей
        const limitedHistory = history.slice(0, MAX_HISTORY_ITEMS);
        await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(limitedHistory));
      } catch (e) {
        console.warn('Failed to save password history:', e.message);
      }
    })();
  }, [history]);

  // Сортировка: закреплённые первые, затем по дате
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

    if (active.length === 0) {
      Alert.alert('Выберите набор символов', 'Включите хотя бы один тип символов');
      return;
    }

    const pool = active.join('');
    let result = '';
    for (const chars of active) result += chars[randomInt(chars.length)];
    while (result.length < length) result += pool[randomInt(pool.length)];

    const arr = result.split('');
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    setPassword(arr.join(''));
    setCopied(false);
    setPasswordVisible(true);
  }

  // Добавить пароль в историю
  function addToHistory(text) {
    setHistory(prev => {
      const existing = prev.find(item => item.text === text);
      if (existing) {
        return sortHistory(
          prev.map(item => (item.text === text ? { ...item, createdAt: Date.now() } : item))
        );
      }
      // UUID вместо Date.now() — избегаем коллизий
      return sortHistory([
        { id: uuidv4(), text, pinned: false, createdAt: Date.now(), note: '' },
        ...prev
      ]).slice(0, MAX_HISTORY_ITEMS);
    });
  }

  // Очистить буфер обмена через N секунд
  function scheduleClipboardClear() {
    if (clipboardTimeoutRef.current) {
      clearTimeout(clipboardTimeoutRef.current);
    }
    clipboardTimeoutRef.current = setTimeout(async () => {
      try {
        await Clipboard.setStringAsync('');
      } catch (e) {
        console.warn('Failed to clear clipboard:', e.message);
      }
      clipboardTimeoutRef.current = null;
    }, CLIPBOARD_TIMEOUT);
  }

  async function copy() {
    if (!password) return;
    try {
      await Clipboard.setStringAsync(password);
      addToHistory(password);
      setCopied(true);
      scheduleClipboardClear();

      // Автоочистка UI уведомления
      const timeoutId = setTimeout(() => setCopied(false), 2000);
      timeoutRefs.current['copy'] = timeoutId;
    } catch (e) {
      console.warn('Failed to copy to clipboard:', e.message);
      Alert.alert('Ошибка', 'Не удалось скопировать пароль в буфер обмена');
    }
  }

  async function copyFromHistory(item) {
    try {
      await Clipboard.setStringAsync(item.text);
      addToHistory(item.text);
      setSelected(null);
      setCopied(true);
      scheduleClipboardClear();

      const timeoutId = setTimeout(() => setCopied(false), 2000);
      timeoutRefs.current['history'] = timeoutId;
    } catch (e) {
      console.warn('Failed to copy from history:', e.message);
      Alert.alert('Ошибка', 'Не удалось скопировать пароль в буфер обмена');
    }
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

  function openNoteEdit(item) {
    setSelected(null);
    setEditTarget(item);
    setNoteDraft(item.note || '');
  }

  function saveNote() {
    if (!editTarget) return;
    const trimmed = noteDraft.trim().slice(0, MAX_NOTE_LENGTH);
    setHistory(prev =>
      prev.map(i => (i.id === editTarget.id ? { ...i, note: trimmed } : i))
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

  // Очистка таймаутов при размонтировании
  useEffect(() => {
    return () => {
      Object.values(timeoutRefs.current).forEach(id => clearTimeout(id));
      if (clipboardTimeoutRef.current) {
        clearTimeout(clipboardTimeoutRef.current);
      }
    };
  }, []);

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
            {fontsLoaded ? (
              <Animated.Text id="app-title" style={[styles.title, { opacity: titleOpacity }]}>Генератор паролей</Animated.Text>
            ) : (
              <Text style={styles.titleWait}>⟳ загрузка шрифта...</Text>
            )}

            {/* Поле пароля с возможностью скрытия */}
            <TouchableOpacity style={styles.passwordBox} onPress={copy} activeOpacity={0.8}>
              {password ? (
                <View style={styles.passwordContainer}>
                  <Text style={styles.password} selectable={passwordVisible}>
                    {passwordVisible ? password : '•'.repeat(password.length)}
                  </Text>
                  <TouchableOpacity
                    style={styles.eyeButton}
                    onPress={() => setPasswordVisible(!passwordVisible)}
                  >
                    <Text style={styles.eyeButtonText}>{passwordVisible ? '👁' : '👁‍🗨'}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.passwordHint}>Нажмите «Сгенерировать»</Text>
              )}
            </TouchableOpacity>

            <Text style={[styles.copied, { opacity: copied ? 1 : 0 }]}>Пароль сохранен!</Text>

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

            <Text style={styles.section}>Сложность</Text>
            <View style={styles.toggles}>
              {Object.entries(SETS).map(([key, s]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.chip, enabled[key] && styles.chipActive]}
                  onPress={() => toggle(key)}
                >
                  <Text
                    style={[styles.chipText, enabled[key] && styles.chipTextActive]}
                    allowFontScaling={false}
                    numberOfLines={1}
                  >
                    {s.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.buttons}>
              <TouchableOpacity style={styles.btnGenerate} onPress={generate}>
                <Text style={styles.btnGenerateText}>Сгенерировать</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnCopy, !password && styles.btnCopyDisabled]}
                onPress={copy}
                disabled={!password}
              >
                <Text
                  style={[styles.btnCopyText, !password && styles.btnCopyTextDisabled]}
                  allowFontScaling={false}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  Копировать
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.btnLibrary} onPress={() => switchScreen('saved')}>
              <Text style={styles.btnLibraryText}>
                Сохранённые пароли ({history.length})
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.stagePart}>
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

      {/* Меню действий */}
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

      {/* Подтверждение удаления */}
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

      {/* Подтверждение очистки всех */}
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

      {/* Просмотр заметки */}
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

      {/* Редактирование заметки */}
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
                  onChangeText={(text) => setNoteDraft(text.slice(0, MAX_NOTE_LENGTH))}
                  placeholder="Введите заметку..."
                  placeholderTextColor="#666"
                  multiline
                  textAlignVertical="top"
                  maxLength={MAX_NOTE_LENGTH}
                />
                <Text style={styles.noteCounter}>{noteDraft.length}/{MAX_NOTE_LENGTH}</Text>
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
    height: 150,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2e2e3e',
  },
  passwordContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  password: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.5,
    flex: 1,
    flexWrap: 'wrap',
  },
  eyeButton: {
    padding: 8,
    marginLeft: 8,
  },
  eyeButtonText: {
    fontSize: 20,
  },
  passwordHint: {
    color: '#555',
    fontSize: 15,
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 1,
  },
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
    gap: 8,
    marginBottom: 8,
  },
  chip: {
    width: '48%',
    backgroundColor: '#1e1e2b',
    borderWidth: 1,
    borderColor: '#3a3a4a',
    borderRadius: 14,
    paddingVertical: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: '#7C6CF0',
    borderColor: '#7C6CF0',
  },
  chipText: {
    color: '#999',
    fontSize: 15,
    fontFamily: 'RussoOne_400Regular',
    textAlign: 'center',
    includeFontPadding: false,
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
    paddingHorizontal: 50,
    alignItems: 'center',
    elevation: 4,
    width: '100%',
  },
  btnGenerateText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
    includeFontPadding: false,
  },
  btnCopy: {
    backgroundColor: '#1a2a3a',
    borderWidth: 1,
    borderColor: '#2a4a6a',
    borderRadius: 18,
    paddingVertical: 18,
    paddingHorizontal: 50,
    alignItems: 'center',
    width: '100%',
  },
  btnCopyText: {
    color: '#60a5fa',
    fontSize: 17,
    fontWeight: '600',
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
    includeFontPadding: false,
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
    paddingHorizontal: 50,
    alignItems: 'center',
    marginTop: 12,
    width: '100%',
  },
  btnLibraryText: {
    color: '#c4b5fd',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: 'RussoOne_400Regular',
    textTransform: 'uppercase',
    includeFontPadding: false,
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
  noteBtn: {
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  noteBtnText: {
    fontSize: 14,
  },
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
  editNoteInput: {
    color: '#fff',
    fontSize: 15,
    backgroundColor: '#2a2a3a',
    borderWidth: 1,
    borderColor: '#3a3a4a',
    borderRadius: 10,
    padding: 12,
    minHeight: 100,
    marginBottom: 8,
  },
  noteCounter: {
    color: '#999',
    fontSize: 12,
    textAlign: 'right',
    marginBottom: 12,
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
