
        // Language-split corner fills (GitHub-style colors, largest language nearest the corner)
        const LANG_COLORS = {
            'Python': '#3572A5', 'TypeScript': '#3178c6', 'JavaScript': '#f1e05a',
            'HTML': '#e34c26', 'CSS': '#663399', 'Jupyter Notebook': '#DA5B0B', 'PLpgSQL': '#336790'
        };
        const MIN_SHARE = 12; // minor languages never render thinner than this (% of the wedge)
        function paintCornerFill(el) {
            const parts = el.dataset.langs.split(',').map(p => {
                const [name, pct] = p.split(':');
                return { name: name.trim(), pct: parseFloat(pct) };
            }).sort((a, b) => b.pct - a.pct);
            const boosted = parts.map(p => Math.max(p.pct, parts.length > 1 ? MIN_SHARE : 0));
            const total = boosted.reduce((a, b) => a + b, 0);
            // A 135deg gradient on the square runs corner-to-corner; the triangle's edge sits at 50%.
            let acc = 0;
            const stops = parts.map((p, i) => {
                const from = acc;
                acc += (boosted[i] / total) * 50;
                const c = LANG_COLORS[p.name] || '#95c7a3';
                return `${c} ${from.toFixed(2)}%, ${c} ${acc.toFixed(2)}%`;
            });
            el.style.background = `linear-gradient(135deg, ${stops.join(', ')})`;
        }
        document.querySelectorAll('.corner-fill[data-langs]').forEach(paintCornerFill);

        // Mobile menu
        const menuBtn = document.getElementById('menu-btn');
        const navMenu = document.getElementById('nav-menu');
        menuBtn.addEventListener('click', () => {
            const open = navMenu.classList.toggle('open');
            menuBtn.setAttribute('aria-expanded', open);
        });
        navMenu.addEventListener('click', e => { if (e.target.closest('a')) navMenu.classList.remove('open'); });
        document.addEventListener('click', e => {
            if (!navMenu.contains(e.target) && !menuBtn.contains(e.target)) { navMenu.classList.remove('open'); menuBtn.setAttribute('aria-expanded', false); }
        });

        // DEV MODE: open index.html?dev to show the edit tools
        if (new URLSearchParams(location.search).has('dev')) {
            document.body.classList.add('dev');
            // Dev assets load only in dev mode; they are stripped again on save.
            const devCss = document.createElement('link');
            devCss.rel = 'stylesheet'; devCss.href = 'css/dev.css'; devCss.setAttribute('data-dev-injected', '');
            document.head.appendChild(devCss);
            const devJs = document.createElement('script');
            devJs.src = 'js/dev-tools.js'; devJs.setAttribute('data-dev-injected', '');
            document.body.appendChild(devJs);
        }

        // Active Nav Highlighter on Scroll
        window.addEventListener('scroll', () => {
            const sections = document.querySelectorAll('section.screen');
            const navLinks = document.querySelectorAll('.nav-link');
            let current = '';
            sections.forEach(section => {
                const sectionTop = section.offsetTop;
                if (window.scrollY >= sectionTop - 180) {
                    current = section.getAttribute('id');
                }
            });

            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href') === '#' + current) {
                    link.classList.add('active');
                }
            });
        });

