/**
 * IME (input method editor) helpers.
 *
 * 约定：凡是自带快捷键的文本输入框（翻译校对页每行 `<textarea>`、假名读音
 * `<input>`）都必须在 `keydown` 开头先问一句 `isImeComposing()`，组字期的按键
 * 只交给输入法，不当作快捷键：
 * - Enter 在组字期是「确认候选 / 上屏」，不是跳行或提交读音；
 * - Escape 在组字期是「取消候选」，不是关闭编辑栏。
 * 新增输入框时照抄这条，否则中日文输入法用户每敲一次候选确认就会误触发快捷键。
 */

/** Minimal shape of a keyboard event we need; works with React synthetic events. */
type ComposingEvent = {
  nativeEvent?: { isComposing?: boolean };
  keyCode?: number;
};

/**
 * True while an IME composition owns the key (Enter = confirm candidate, not a shortcut).
 *
 * React 合成事件的 `isComposing` 由 Chrome/Firefox 等提供；Safari 在组字完成的那一次
 * keydown 上 `isComposing` 可能为 false，但此时 `keyCode` 固定是 229，所以两者取或。
 */
export function isImeComposing(event: ComposingEvent): boolean {
  return event.nativeEvent?.isComposing === true || event.keyCode === 229;
}
