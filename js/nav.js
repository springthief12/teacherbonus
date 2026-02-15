(function() {
  var MENU_ITEMS = [
    { label: '성과급 계산기', href: '/bonus.html' },
    { label: '자리 배치', href: '/seating.html' },
    { label: '랜덤 번호', href: '/random.html' }
  ];

  var currentPath = window.location.pathname;

  function isActive(href) {
    if (href === '/') return currentPath === '/' || currentPath === '/index.html';
    return currentPath === href || currentPath.endsWith(href);
  }

  var nav = document.createElement('nav');
  nav.className = 'nav-bar';

  var inner = document.createElement('div');
  inner.className = 'nav-inner';

  var logo = document.createElement('a');
  logo.className = 'nav-logo';
  logo.href = '/';
  logo.textContent = '티처툴';
  inner.appendChild(logo);

  var ul = document.createElement('ul');
  ul.className = 'nav-links';

  for (var i = 0; i < MENU_ITEMS.length; i++) {
    var li = document.createElement('li');
    var a = document.createElement('a');
    a.href = MENU_ITEMS[i].href;
    a.textContent = MENU_ITEMS[i].label;
    if (isActive(MENU_ITEMS[i].href)) a.className = 'active';
    li.appendChild(a);
    ul.appendChild(li);
  }
  inner.appendChild(ul);

  var toggle = document.createElement('button');
  toggle.className = 'nav-toggle';
  toggle.setAttribute('aria-label', '메뉴');
  toggle.innerHTML = '&#9776;';
  toggle.addEventListener('click', function() {
    ul.classList.toggle('open');
  });
  inner.appendChild(toggle);

  nav.appendChild(inner);
  document.body.insertBefore(nav, document.body.firstChild);

  document.addEventListener('click', function(e) {
    if (!nav.contains(e.target)) {
      ul.classList.remove('open');
    }
  });
})();
