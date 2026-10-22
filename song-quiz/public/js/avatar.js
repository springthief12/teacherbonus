// 캐릭터 SVG 생성기: 테두리 없는 플랫 스타일의 둥근 캐릭터
(function () {
  const COLORS = [
    { name: '살구', body: '#FFB59E', dark: '#C4583F' },
    { name: '노랑', body: '#FFD84A', dark: '#8A6A00' },
    { name: '민트', body: '#8FD9BC', dark: '#2E8F66' },
    { name: '하늘', body: '#9CCBF5', dark: '#3577B0' },
    { name: '라벤더', body: '#C7B6F5', dark: '#6E55C2' },
    { name: '분홍', body: '#F7AFCB', dark: '#B84F7E' },
    { name: '연두', body: '#C2E08E', dark: '#5E8526' },
    { name: '베이지', body: '#E6D8C1', dark: '#85735A' },
  ];
  const FACES = ['방긋', '활짝', '선글라스', '윙크'];
  const ITEMS = ['없음', '헤드폰', '왕관', '비니', '리본'];
  const INK = '#2A231B';

  function eye(cx, cy) {
    return `<ellipse cx="${cx}" cy="${cy}" rx="3.6" ry="4.6" fill="${INK}"/>
            <circle cx="${cx + 1.2}" cy="${cy - 1.6}" r="1.2" fill="#fff"/>`;
  }

  function face(kind) {
    const smile = `<path d="M44.5 66 Q50 71 55.5 66" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
    switch (kind) {
      case 1: // 활짝
        return eye(40, 55) + eye(60, 55)
          + `<path d="M43 64 H57 Q57 74 50 74 Q43 74 43 64 Z" fill="${INK}"/>
             <path d="M46 70.5 Q50 73.5 54 70.5 Q53 73 50 73 Q47 73 46 70.5 Z" fill="#FF8A80"/>`;
      case 2: // 선글라스
        return `<rect x="30" y="49" width="17" height="11" rx="5.5" fill="${INK}"/>
                <rect x="53" y="49" width="17" height="11" rx="5.5" fill="${INK}"/>
                <rect x="46" y="52" width="8" height="2.6" rx="1.3" fill="${INK}"/>
                <rect x="33" y="51.5" width="6" height="2" rx="1" fill="#fff" opacity=".5"/>` + smile;
      case 3: // 윙크
        return eye(40, 55)
          + `<path d="M56 56 Q60 51.5 64 56" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>` + smile;
      default: // 방긋
        return eye(40, 55) + eye(60, 55) + smile;
    }
  }

  function item(kind) {
    switch (kind) {
      case 1: // 헤드폰
        return `<path d="M19 54 C19 16 81 16 81 54" fill="none" stroke="#3A322A" stroke-width="5" stroke-linecap="round"/>
                <rect x="11" y="46" width="12" height="21" rx="6" fill="#3A322A"/>
                <rect x="77" y="46" width="12" height="21" rx="6" fill="#3A322A"/>`;
      case 2: // 왕관
        return `<path d="M34 27 L35.5 12 L43.5 19 L50 9 L56.5 19 L64.5 12 L66 27 Z" fill="#FFC21A"/>
                <rect x="34" y="24" width="32" height="5" rx="2.5" fill="#F0A800"/>
                <circle cx="50" cy="18" r="2.2" fill="#fff" opacity=".8"/>`;
      case 3: // 비니
        return `<path d="M21 36 Q22 9 50 9 Q78 9 79 36 Z" fill="#7FB3E8"/>
                <rect x="19" y="30" width="62" height="10" rx="5" fill="#5E97D6"/>
                <circle cx="50" cy="8" r="5" fill="#5E97D6"/>`;
      case 4: // 리본
        return `<path d="M63 22 L51 13 Q47 20 51 28 Z M63 22 L75 13 Q79 20 75 28 Z" fill="#F27BA8"/>
                <circle cx="63" cy="21" r="4" fill="#E0588C"/>`;
      default:
        return '';
    }
  }

  function svg(avatar = {}) {
    const color = COLORS[avatar.color] || COLORS[0];
    return `
    <svg class="avatar" viewBox="0 0 100 100" role="img" aria-label="캐릭터">
      <ellipse cx="50" cy="94" rx="27" ry="3.5" fill="${INK}" opacity=".08"/>
      <rect x="16" y="24" width="68" height="67" rx="30" fill="${color.body}"/>
      <ellipse cx="36" cy="36" rx="11" ry="6" fill="#fff" opacity=".35" transform="rotate(-20 36 36)"/>
      <ellipse cx="29" cy="66" rx="5.5" ry="3.2" fill="#FF7A6E" opacity=".28"/>
      <ellipse cx="71" cy="66" rx="5.5" ry="3.2" fill="#FF7A6E" opacity=".28"/>
      ${face(avatar.face || 0)}
      ${item(avatar.item || 0)}
    </svg>`;
  }

  function escape(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.Avatar = { svg, COLORS, FACES, ITEMS, escape };
})();
