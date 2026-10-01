export function chatMessageMarkup(message, stickerCatalog, escapeHtml) {
  const sticker = stickerCatalog.find((entry) => entry.emoji === message.text.trim());
  if (sticker) {
    return `<li class="online-chat-message is-sticker"><strong>${escapeHtml(message.name)}</strong><img class="chat-sticker" src="${escapeHtml(sticker.src)}" alt="${escapeHtml(sticker.alt || sticker.name)}" title="${escapeHtml(sticker.name)}" /></li>`;
  }

  let text = escapeHtml(message.text);
  stickerCatalog.filter((entry) => entry.emoji && entry.src).forEach((entry) => {
    const image = `<img class="chat-inline-emoji" src="${escapeHtml(entry.src)}" alt="${escapeHtml(entry.alt || entry.name)}" title="${escapeHtml(entry.name)}" />`;
    text = text.split(escapeHtml(entry.emoji)).join(image);
  });
  return `<li class="online-chat-message"><strong>${escapeHtml(message.name)}</strong><span>${text}</span></li>`;
}

export function sortedEmojiCatalog({ emojiCatalog, emojiSelectedGroup, emojiSortMode, recentEmojis, emojiUsage }) {
  const recentOrder = new Map(recentEmojis.map((emoji, index) => [emoji, index]));
  return emojiCatalog
    .filter((entry) => emojiSelectedGroup === 'all' || entry.category === emojiSelectedGroup)
    .sort((first, second) => {
      if (emojiSortMode === 'groups') return first.index - second.index;
      if (emojiSortMode === 'recent') {
        const firstRecent = recentOrder.get(first.emoji) ?? Number.MAX_SAFE_INTEGER;
        const secondRecent = recentOrder.get(second.emoji) ?? Number.MAX_SAFE_INTEGER;
        return firstRecent - secondRecent || first.index - second.index;
      }
      return (emojiUsage[second.emoji] || 0) - (emojiUsage[first.emoji] || 0) || first.index - second.index;
    });
}

export function emojiPickerMarkup({ emojiCatalog, emojiSelectedGroup, emojiSortMode, recentEmojis, emojiUsage, emojiShowAll, escapeHtml }) {
  const sorted = sortedEmojiCatalog({ emojiCatalog, emojiSelectedGroup, emojiSortMode, recentEmojis, emojiUsage });
  const visible = emojiShowAll ? sorted : sorted.slice(0, 28);
  const groups = [...new Set(emojiCatalog.map((entry) => entry.category))];
  return `<label class="emoji-group-filter"><span>المجموعة</span><select data-action="emoji-category" aria-label="اختيار مجموعة الإيموجي">
      <option value="all" ${emojiSelectedGroup === 'all' ? 'selected' : ''}>كل المجموعات</option>
      ${groups.map((group) => `<option value="${escapeHtml(group)}" ${emojiSelectedGroup === group ? 'selected' : ''}>${escapeHtml(group)}</option>`).join('')}
    </select></label>
    <div class="emoji-sort-controls" role="group" aria-label="ترتيب الإيموجي">
      <button type="button" data-action="emoji-sort" data-sort="groups" aria-pressed="${emojiSortMode === 'groups'}">حسب المجموعة</button>
      <button type="button" data-action="emoji-sort" data-sort="popular" aria-pressed="${emojiSortMode === 'popular'}">الأكثر استخداماً</button>
      <button type="button" data-action="emoji-sort" data-sort="recent" aria-pressed="${emojiSortMode === 'recent'}">الأخيرة</button>
    </div>
    <div class="emoji-picker-grid">${visible.map((entry) => `<button type="button" data-action="chat-emoji-select" data-emoji="${escapeHtml(entry.emoji)}" aria-label="إدراج ${escapeHtml(entry.emoji)}" title="${escapeHtml(entry.emoji)}">${escapeHtml(entry.emoji)}</button>`).join('')}</div>
    ${sorted.length > visible.length ? `<button type="button" class="emoji-show-more" data-action="emoji-show-all">عرض باقي الإيموجي (${sorted.length - visible.length})</button>` : ''}`;
}

export function stickerPickerMarkup(stickerCatalog, escapeHtml) {
  return stickerCatalog.length
    ? `<div class="sticker-picker-grid">${stickerCatalog.map((sticker) => `<button type="button" data-action="chat-sticker-send" data-sticker-token="${escapeHtml(sticker.emoji)}" aria-label="إرسال ملصق ${escapeHtml(sticker.name || sticker.emoji)}" title="${escapeHtml(sticker.name || sticker.emoji)}"><img src="${escapeHtml(sticker.src)}" alt="${escapeHtml(sticker.alt || sticker.name)}" /><span>${escapeHtml(sticker.name || sticker.emoji)}</span></button>`).join('')}</div>`
    : '<p class="sticker-picker-empty">لا توجد ملصقات مخصصة في الكتالوج.</p>';
}
