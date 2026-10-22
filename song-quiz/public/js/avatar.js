// 카세트테이프 캐릭터 SVG 생성기
(function () {
  const COLORS = [
    { name: '살구', body: '#FFB4A2', dark: '#C9644F' },
    { name: '노랑', body: '#FFDD6B', dark: '#A97D0B' },
    { name: '민트', body: '#A3DCC4', dark: '#3F8A62' },
    { name: '하늘', body: '#AED4F2', dark: '#3F7FB5' },
    { name: '라벤더', body: '#CDBDF2', dark: '#7A5EC4' },
    { name: '분홍', body: '#F9B9D2', dark: '#C25A85' },
    { name: '연두', body: '#CDE5A1', dark: '#6B8F33' },
    { name: '베이지', body: '#EADCC4', dark: '#8C7761' },
  ];
  const FACES = ['방긋', '활짝', '선글라스', '윙크'];
  const ITEMS = ['없음', '헤드폰', '왕관', '비니', '리본'];
  const INK = '#5A4632';

  function reel(cx, cy, cls) {
    return `
      <g class="reel ${cls}" style="transform-origin:${cx}px ${cy}px">
        <circle cx="${cx}" cy="${cy}" r="7.5" fill="#fff"/>
        <circle cx="${cx}" cy="${cy}" r="3.2" fill="${INK}"/>
        <rect x="${cx - 0.9}" y="${cy - 7}" width="1.8" height="3" fill="${INK}"/>
        <rect x="${cx - 0.9}" y="${cy + 4}" width="1.8" height="3" fill="${INK}"/>
        <rect x="${cx - 7}" y="${cy - 0.9}" width="3" height="1.8" fill="${INK}"/>
        <rect x="${cx + 4}" y="${cy - 0.9}" width="3" height="1.8" fill="${INK}"/>
      </g>`;
  }

  function face(kind) {
    let eyes = reel(38, 58, 'reel-l') + reel(62, 58, 'reel-r');
    let mouth = `<path d="M44 75 Q50 80 56 75" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
    if (kind === 1) {
      mouth = `<path d="M43 73 H57 Q57 81 50 81 Q43 81 43 73 Z" fill="${INK}"/><path d="M46 78 Q50 80.5 54 78" fill="#FF7E8A"/>`;
    }
    if (kind === 2) {
      eyes += `<path d="M27 52 H73 V58 Q73 66 64 66 Q55 66 54 58 H46 Q45 66 36 66 Q27 66 27 58 Z" fill="${INK}"/>
               <path d="M31 55 L38 55" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".7"/>`;
      mouth = `<path d="M45 76 Q51 79 56 75" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
    }
    if (kind === 3) {
      eyes = reel(38, 58, 'reel-l') + `<path d="M56 59 Q62 54 68 59" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`;
      mouth = `<path d="M44 74 Q50 80 56 74" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><circle cx="57.5" cy="74" r="1.4" fill="${INK}"/>`;
    }
    return eyes + mouth;
  }

  function item(kind, color) {
    switch (kind) {
      case 1: // 헤드폰
        return `<path d="M14 50 Q14 12 50 12 Q86 12 86 50" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round"/>
                <rect x="5" y="42" width="12" height="22" rx="5" fill="${INK}"/>
                <rect x="83" y="42" width="12" height="22" rx="5" fill="${INK}"/>
                <rect x="8" y="46" width="6" height="14" rx="3" fill="${color.body}"/>
                <rect x="86" y="46" width="6" height="14" rx="3" fill="${color.body}"/>`;
      case 2: // 왕관
        return `<path d="M33 27 L35 11 L44 19 L50 7 L56 19 L65 11 L67 27 Z" fill="#FFD23F" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
                <circle cx="50" cy="20" r="2.4" fill="#FFB4A2"/>`;
      case 3: // 비니
        return `<path d="M22 30 Q24 6 50 6 Q76 6 78 30 Z" fill="#AED4F2" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
                <rect x="19" y="24" width="62" height="9" rx="4.5" fill="#FFD23F" stroke="${INK}" stroke-width="2.6"/>
                <circle cx="50" cy="5" r="5" fill="#FFD23F" stroke="${INK}" stroke-width="2.4"/>`;
      case 4: // 리본
        return `<path d="M50 24 L34 14 Q29 24 34 33 Z M50 24 L66 14 Q71 24 66 33 Z" fill="#F9B9D2" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>
                <circle cx="50" cy="24" r="4.5" fill="#F9B9D2" stroke="${INK}" stroke-width="2.6"/>`;
      default:
        return '';
    }
  }

  function svg(avatar = {}, opts = {}) {
    const color = COLORS[avatar.color] || COLORS[0];
    const label = opts.label ? String(opts.label).slice(0, 6) : '';
    return `
    <svg class="cassette" viewBox="0 0 100 100" role="img" aria-label="캐릭터">
      <ellipse cx="50" cy="95" rx="30" ry="3.5" fill="${INK}" opacity=".18"/>
      <rect x="28" y="84" width="10" height="9" rx="3" fill="${INK}"/>
      <rect x="62" y="84" width="10" height="9" rx="3" fill="${INK}"/>
      <rect x="10" y="27" width="80" height="59" rx="11" fill="${color.body}" stroke="${INK}" stroke-width="3"/>
      <rect x="18" y="33" width="64" height="11" rx="3" fill="#fff" opacity=".9"/>
      <text x="50" y="41.6" text-anchor="middle" font-size="8" font-family="Pretendard Variable, Pretendard, sans-serif" font-weight="800" fill="${INK}">${escape(label)}</text>
      <rect x="23" y="48" width="54" height="20" rx="10" fill="${INK}"/>
      <path d="M29 86 L33 71 H67 L71 86 Z" fill="#fff" fill-opacity=".6" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>
      <circle cx="17" cy="73" r="4" fill="#FF8FA0" opacity=".75"/>
      <circle cx="83" cy="73" r="4" fill="#FF8FA0" opacity=".75"/>
      ${face(avatar.face || 0)}
      ${item(avatar.item || 0, color)}
    </svg>`;
  }

  function escape(text) {
    return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.Avatar = { svg, COLORS, FACES, ITEMS, escape };
})();
