// Собрано build.py из lampa/core.js и plugins/random/plugin.js.
// Правки вносятся в исходники, этот файл перезаписывается.
// Общая обвязка для плагинов Lampa: запуск, манифест, стили, доступ к открытой
// карточке фильма и сеть. Файл вклеивается в начало каждого плагина сборкой
// (build.py), так что в рантайме он уже часть плагина и отдельным запросом не
// тянется.
(function () {
    'use strict';

    // Два собранных плагина несут по своей копии ядра. Первая выигрывает —
    // API у них одинаковое, а двойное определение ничего не даёт.
    if (window.LampaCore) return;

    var Core = {};

    // Lampa поднимается не мгновенно, а как расширение браузера плагин
    // выполняется вообще раньше страницы. Ждём готовности обоих.
    function waitForLampa(attempt, ready, giveup) {
        var available = typeof Lampa !== 'undefined' && Lampa.Storage && Lampa.Component &&
            Lampa.Activity && Lampa.Controller && Lampa.Listener && typeof window.$ === 'function';

        if (available) {
            if (window.appready) return ready();

            return Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') ready();
            });
        }

        if (attempt > 300) return giveup();

        setTimeout(function () { waitForLampa(attempt + 1, ready, giveup); }, 200);
    }

    // Часть плагинов кладёт в Manifest.plugins объект, часть — массив. Приводим
    // к массиву: иначе второй установленный плагин затирает запись первого, и
    // тот пропадает из списка расширений.
    function registerManifest(manifest) {
        if (!Array.isArray(Lampa.Manifest.plugins)) {
            Lampa.Manifest.plugins = Lampa.Manifest.plugins ? [Lampa.Manifest.plugins] : [];
        }

        var known = Lampa.Manifest.plugins.some(function (plugin) {
            return plugin && plugin.name === manifest.name;
        });

        if (!known) Lampa.Manifest.plugins.push(manifest);
    }

    // options: { flag, manifest, styles: { id, css }, start }
    Core.boot = function (options) {
        // Плагин может приехать дважды: и как расширение браузера, и из списка
        // плагинов Lampa. Второй раз просто выходим.
        if (window[options.flag]) return;
        window[options.flag] = true;

        waitForLampa(0, function () {
            registerManifest(options.manifest);
            if (options.styles) Core.addStyles(options.styles.id, options.styles.css);
            options.start();
        }, function () {
            console.error(options.manifest.name + ': Lampa так и не появилась, сдаёмся');
        });
    };

    Core.addStyles = function (id, css) {
        if (document.getElementById(id)) return;

        var style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
    };

    Core.stored = function (name, fallback) {
        return String(Lampa.Storage.get(name, fallback) || fallback);
    };

    // Разные источники зовут тип по-разному, а часть карточек не несёт его
    // вовсе — тогда опознаём по полям, которые есть только у сериалов.
    Core.cardMethod = function (data) {
        if (!data) return 'movie';
        if (data.method === 'movie' || data.method === 'tv') return data.method;
        if (data.media_type === 'movie' || data.media_type === 'tv') return data.media_type;
        if (data.type === 'movie' || data.type === 'tv') return data.type;
        return (data.number_of_seasons || data.first_air_date || data.name) ? 'tv' : 'movie';
    };

    Core.cardYear = function (card) {
        var year = Number(String((card && (card.release_date || card.first_air_date)) || '').slice(0, 4));
        return year || 0;
    };

    Core.cardTitle = function (card) {
        return (card && (card.title || card.name || card.original_title || card.original_name)) || '';
    };

    // Открытая карточка целиком: сама запись, её тип и корень активности.
    // Искать по документу нельзя — прошлые карточки остаются в DOM, и запрос
    // вернёт кнопки фильма, который человек уже закрыл.
    function currentCard() {
        var active = Lampa.Activity.active();
        var card = active && active.card;

        if (!card || !card.id || !active.activity) return null;

        var method = (active.method === 'movie' || active.method === 'tv')
            ? active.method
            : Core.cardMethod(card);

        return { card: card, method: method, render: active.activity.render(), activity: active.activity };
    }

    Core.currentCard = currentCard;

    // 'complite' — опечатка самой Lampa, событие приходит именно так
    Core.onFullCard = function (callback) {
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var ctx = currentCard();
            if (ctx) callback(ctx);
        });
    };

    // Свежие сборки Lampa разметили карточку заново, старые ещё живут со
    // старыми классами — ищем по обоим.
    Core.cardButtons = function (ctx) {
        return ctx.render.find('.full-start-new__buttons, .full-start__buttons');
    };

    Core.cardLeft = function (ctx) {
        return ctx.render.find('.full-start-new__left, .full-start__left');
    };

    // Кнопка в ряду под постером. Разметку копируем у родных кнопок: Lampa сама
    // и стилизует её, и прячет подпись у второстепенных.
    // options: { className, icon, title, onEnter, after }
    Core.cardButton = function (ctx, options) {
        var container = Core.cardButtons(ctx);
        if (!container.length || container.find('.' + options.className).length) return null;

        var button = $(
            '<div class="full-start__button selector ' + options.className + '">' +
            (options.icon || '') +
            '<span>' + (options.title || '') + '</span>' +
            '</div>'
        );

        button.on('hover:enter', options.onEnter);

        var anchor = options.after ? container.find(options.after) : $();
        if (anchor.length) button.insertAfter(anchor.first());
        else container.prepend(button);

        return button;
    };

    // Строка вроде «сезон · серия» под названием. Кладём её туда же, куда
    // Lampa кладёт свои детали, чтобы она не висела отдельным блоком.
    Core.cardDetails = function (ctx, className, html) {
        var line = ctx.render.find('.' + className);

        if (!line.length) {
            line = $('<div class="full-start-new__details ' + className + '"></div>');

            var rate = ctx.render.find('.full-start-new__rate-line');
            var details = ctx.render.find('.full-start-new__details').not('.' + className);
            var left = Core.cardLeft(ctx);

            if (rate.length) line.insertAfter(rate.first());
            else if (details.length) line.insertAfter(details.first());
            else if (left.length) left.append(line);
            else return null;
        }

        line.html(html);
        return line;
    };

    function encodeBody(options) {
        if (options.form) {
            return Object.keys(options.form).map(function (name) {
                return encodeURIComponent(name) + '=' + encodeURIComponent(options.form[name]);
            }).join('&');
        }

        return options.body === undefined ? null : JSON.stringify(options.body);
    }

    // Свой XHR, а не Lampa.Reguest: тому нельзя передать заголовки, а без
    // Authorization запрос к чужому API не пройдёт. TMDB по-прежнему ходит
    // через Lampa.Reguest — там важны пользовательские настройки прокси.
    // Тело задаётся либо `body` (уедет как json), либо `form` (как
    // application/x-www-form-urlencoded, чего требуют эндпоинты OAuth).
    // options: { url, method, headers, body, form, timeout, onDone, onFail }
    Core.request = function (options) {
        var xhr = new XMLHttpRequest();
        var headers = options.headers || {};

        xhr.open(options.method || 'GET', options.url, true);
        Object.keys(headers).forEach(function (name) {
            xhr.setRequestHeader(name, headers[name]);
        });
        xhr.timeout = options.timeout || 15000;

        function fail(status, body) {
            if (options.onFail) options.onFail(status, body);
        }

        xhr.onload = function () {
            var parsed = null;

            try {
                if (xhr.responseText) parsed = JSON.parse(xhr.responseText);
            } catch (e) {
                // Тело не json — для успешного ответа это нормально (204),
                // для ошибки разбирать всё равно нечего.
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                if (options.onDone) options.onDone(parsed, xhr.status);
            } else {
                fail(xhr.status, parsed);
            }
        };

        xhr.onerror = function () { fail(0, null); };
        xhr.ontimeout = function () { fail(0, null); };

        xhr.send(encodeBody(options));

        return xhr;
    };

    window.LampaCore = Core;
})();

(function () {
    'use strict';

    var Core = window.LampaCore;

    var manifest = {
        type: 'other',
        version: '1.2.0',
        name: 'Случайное',
        description: 'Случайный фильм или сериал: кнопки в шапке, экран с фильтрами и кнопка трейлера на YouTube',
        component: 'random_picker'
    };

    // TMDB отдаёт 400 на любую страницу выше 500-й
    const TMDB_MAX_PAGE = 500;

    // Пул для глобального рандома. Год 2000+ и 200 голосов дают ~10 700 фильмов
    // (535 страниц), из которых лимит в 500 страниц покрывает 93%.
    const DISCOVER_MIN_YEAR = 2000;
    const DISCOVER_MIN_VOTES_MOVIE = 200;
    const DISCOVER_MIN_VOTES_TV = 100;
    // Одна страница — это срез каталога по популярности, 20 одинаково
    // раскрученных тайтлов подряд. Берём сразу несколько разных страниц и
    // перемешиваем, чтобы соседние нажатия не выдавали один и тот же пласт.
    const DISCOVER_PAGES_PER_FETCH = 5;
    // Оценка по 10-балльной шкале
    const DISCOVER_MIN_RATING = 6;
    // Дошкольное отсекаем по связке «семейное + мультфильм»: она ловит
    // «Тачки» и «Миньонов», но оставляет семейное кино уровня 12+ вроде
    // «Гарри Поттера». Фильтр по возрастному рейтингу тут не годится —
    // сертификация заполнена у 60% каталога, остальное просто выпало бы.
    const GENRE_FAMILY = 10751;
    const GENRE_ANIMATION = 16;
    const GENRE_TV_KIDS = 10762;

    // Порог для рандома внутри открытой категории: она приходит без фильтров
    // качества, а 500 страниц уводят глубоко в хвост каталога.
    const CATEGORY_MIN_VOTES = 20;

    // Жанры у фильмов и сериалов в TMDB нумеруются по-разному, поэтому списки
    // отдельные: «Боевик» у фильма — 28, у сериала — 10759.
    const GENRES_MOVIE = {
        '0': 'Любой', '28': 'Боевик', '12': 'Приключения', '16': 'Мультфильм',
        '35': 'Комедия', '80': 'Криминал', '99': 'Документальный', '18': 'Драма',
        '10751': 'Семейный', '14': 'Фэнтези', '36': 'Исторический', '27': 'Ужасы',
        '10402': 'Музыка', '9648': 'Детектив', '10749': 'Мелодрама',
        '878': 'Фантастика', '53': 'Триллер', '10752': 'Военный', '37': 'Вестерн'
    };
    const GENRES_TV = {
        '0': 'Любой', '10759': 'Боевик и приключения', '16': 'Мультфильм',
        '35': 'Комедия', '80': 'Криминал', '99': 'Документальный', '18': 'Драма',
        '10751': 'Семейный', '9648': 'Детектив', '10764': 'Реалити',
        '10765': 'Фантастика и фэнтези', '10766': 'Мыльная опера',
        '10768': 'Война и политика', '37': 'Вестерн'
    };
    const YEARS_FROM = { '0': 'Не важно' };
    const YEARS_TO = { '0': 'Не важно' };
    for (let year = new Date().getFullYear(); year >= DISCOVER_MIN_YEAR; year--) {
        YEARS_FROM[year] = String(year);
        YEARS_TO[year] = String(year);
    }
    const RATINGS = { '0': 'Любой', '5': 'от 5', '6': 'от 6', '7': 'от 7', '8': 'от 8' };

    const TYPES = { 'movie': 'Фильмы', 'tv': 'Сериалы' };

    // Где искать. Избранное лежит локально целыми карточками, так что выбор из
    // него идёт без сети.
    const SOURCES = { 'catalog': 'Весь каталог', 'favorite': 'Избранное' };
    // «Смотрю», «Закладки» и «Позже». Просмотренное, брошенное и история сюда
    // не входят: это не «хочу посмотреть».
    const FAVORITE_LISTS = ['look', 'book', 'wath'];

    let queue = [];
    let context = null;
    // Чем повторить последний случайный выбор. Живёт до ближайшей открытой
    // карточки: она забирает его себе на кнопку «Ещё» и обнуляет, чтобы кнопка
    // не появлялась на карточках, открытых обычным способом.
    let random_repeat = null;

    // Загруженная страница переживает клики: карточки раздаются по одной,
    // так что в сеть ходим раз на 20 нажатий. Размер каталога спрашиваем
    // один раз — он не меняется.
    const buffers = {};
    const page_counts = {};

    const BUFFERS_KEY = 'random_buffers';
    const PAGE_COUNTS_KEY = 'random_page_counts';
    const CACHE_TIME_KEY = 'random_cache_time';
    // Из ~100 собранных карточек раздаём 20, после чего идём за новыми
    // страницами — иначе один и тот же пул тянулся бы слишком долго.
    const BUFFER_LIMIT = 20;
    // Каталог TMDB пополняется, поэтому раз в неделю пересчитываем его размер
    // и набираем пул заново.
    const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

    const STYLES = `
        .random-screen { padding: 1.5em; max-width: 40em; }
        .random-screen .settings-param {
            display: flex; justify-content: space-between; align-items: center;
            padding: 1.2em 1.4em; margin-bottom: 0.6em; border-radius: 0.6em;
            background-color: rgba(255, 255, 255, 0.06);
        }
        .random-screen .settings-param__name { font-size: 1.2em; }
        .random-screen .settings-param__value { opacity: 0.7; margin-left: 1.5em; text-align: right; }
        .random-screen .settings-param.focus { background-color: #fff; color: #000; }
        .random-screen__go {
            margin-top: 1.5em; padding: 1.2em; border-radius: 0.6em; text-align: center;
            font-size: 1.2em; font-weight: 600; background-color: rgba(255, 255, 255, 0.14);
        }
        .random-screen__go.focus { background-color: #fff; color: #000; }
        .random-more {
            margin-top: 1.2em; padding: 1em 1.2em; border-radius: 0.6em;
            text-align: center; font-weight: 600;
            background-color: rgba(255, 255, 255, 0.14);
        }
        .random-more.focus { background-color: #fff; color: #000; }
    `;

    // Родные спрайты Lampa: свои контурные иконки выбивались из ряда, где все
    // остальные — сплошная заливка одного веса.
    const HEAD_BUTTONS = [
        { id: 'lampa-random-button', type: 'movie', title: 'Случайный фильм', sprite: 'sprite-movie' },
        { id: 'lampa-random-button-tv', type: 'tv', title: 'Случайный сериал', sprite: 'sprite-tv' }
    ];

    function shuffled(items) {
        const copy = items.slice();
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const swap = copy[i];
            copy[i] = copy[j];
            copy[j] = swap;
        }
        return copy;
    }

    var stored = Core.stored;

    // Раньше источником мог быть отдельный список избранного. Приводим такое
    // значение к «favorite», иначе экран показывал бы одно, а искал в другом.
    function sourceValue() {
        const saved = stored('random_source', 'catalog');
        const value = saved === 'catalog' ? 'catalog' : 'favorite';

        if (value !== saved) Lampa.Storage.set('random_source', value);
        return value;
    }

    // Каталог от перезагрузки к перезагрузке тот же, так что пул переживает
    // сессию: после первого похода в сеть кнопка работает вообще без запросов.
    function loadCache() {
        try {
            const saved_at = Lampa.Storage.get(CACHE_TIME_KEY, '0') || 0;

            if (saved_at && Date.now() - saved_at < CACHE_TTL) {
                Object.assign(buffers, Lampa.Storage.get(BUFFERS_KEY, '{}') || {});
                Object.assign(page_counts, Lampa.Storage.get(PAGE_COUNTS_KEY, '{}') || {});
            } else if (saved_at) {
                console.log('Lampa Random: Cache expired, starting fresh');
            }
        } catch (e) {
            console.error('Lampa Random: Failed to read cache', e);
        }
    }

    function persistCache() {
        try {
            Lampa.Storage.set(BUFFERS_KEY, buffers);
            Lampa.Storage.set(PAGE_COUNTS_KEY, page_counts);
            Lampa.Storage.set(CACHE_TIME_KEY, Date.now());
        } catch (e) {
            console.error('Lampa Random: Failed to write cache', e);
        }
    }

    function takeBuffered(key) {
        const buf = buffers[key];
        if (!buf || !buf.length) return null;

        const item = buf.pop();
        persistCache();
        return item;
    }

    function fillBuffer(key, items) {
        buffers[key] = shuffled(items).slice(0, BUFFER_LIMIT);
        persistCache();
        return buffers[key].pop();
    }

    function updateQueue() {
        const active = Lampa.Activity.active();
        if (!active || !active.activity || !active.activity.component) return;

        const comp = active.activity.component;
        const obj = comp.object;

        // Собираем всё, что уже загружено: и постранично, и из DOM
        let itemsMap = new Map();
        if (comp.loaded) {
            Object.keys(comp.loaded).forEach(page => {
                if (Array.isArray(comp.loaded[page])) {
                    comp.loaded[page].forEach(item => {
                        if (item && item.id) itemsMap.set(item.id, item);
                    });
                }
            });
        }
        document.querySelectorAll('.card.selector').forEach(c => {
            if (c.card_data && c.card_data.id) {
                itemsMap.set(c.card_data.id, c.card_data);
            }
        });

        if (itemsMap.size > 0) queue = Array.from(itemsMap.values());

        if (obj && obj.url && !obj.card) {
            context = {
                url: obj.url,
                params: Object.assign({}, obj),
                total_pages: comp.total_pages || 1,
                source: obj.source || 'tmdb'
            };
        } else if (active.component !== 'full') {
            // Экран без своего url (главная) — контекст прошлой категории к нему
            // не относится. На карточке фильма контекст сохраняем, чтобы шафл
            // продолжал ходить по той же категории.
            context = null;
        }
    }

    var getMethod = Core.cardMethod;

    function navigateTo(data) {
        if (!data || !data.id) return;
        const params = Object.assign({}, data);
        params.component = 'full';
        params.method = getMethod(data);
        params.card = data;
        if (!params.title) params.title = data.name || data.title;

        console.log('Lampa Random: Jumping to ->', params.title);

        const active = Lampa.Activity.active();
        if (active && active.component === 'full' && active.activity && active.activity.component &&
            active.activity.component.object && active.activity.component.object.card) {
            Lampa.Activity.replace(params);
        } else {
            Lampa.Activity.push(params);
        }
    }

    // В хвосте больших категорий лежат записи без оценок и постеров. Берём из
    // страницы только то, что кто-то смотрел, а если вся страница такая —
    // отдаём самое заметное, чтобы клик всё равно куда-то вёл.
    function preferDecent(results) {
        const decent = results.filter(item =>
            !item.adult && item.poster_path && (item.vote_count || 0) >= CATEGORY_MIN_VOTES
        );
        if (decent.length) return decent;

        return results.slice().sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 1);
    }

    // Случайный фильм или сериал по всему каталогу TMDB. В сеть ходим, только
    // когда кончился отложенный пул: размер каталога берём из кэша, страницу —
    // из буфера.
    function discoverRandom(method, filters, onFail) {
        const is_tv = method === 'tv';
        // Фильтры входят в ключ: иначе после их смены кнопка продолжила бы
        // раздавать старый пул, пока тот не кончится. Заодно это разводит
        // кэш кнопок и кэш меню.
        const key = 'discover:' + method + ':' + filters.genre + ':' +
            filters.year_from + '-' + filters.year_to + ':' + filters.rating;

        const buffered = takeBuffered(key);
        if (buffered) {
            console.log('Lampa Random: From cache,', (buffers[key] || []).length, 'left');
            return navigateTo(buffered);
        }

        const date_field = is_tv ? 'first_air_date' : 'primary_release_date';
        const min_votes = is_tv ? DISCOVER_MIN_VOTES_TV : DISCOVER_MIN_VOTES_MOVIE;
        const min_year = filters.year_from !== '0' ? filters.year_from : DISCOVER_MIN_YEAR;
        const min_rating = filters.rating !== '0' ? filters.rating : DISCOVER_MIN_RATING;

        const query = 'discover/' + method +
            '?sort_by=popularity.desc' +
            '&include_adult=false' +
            '&vote_count.gte=' + min_votes +
            '&vote_average.gte=' + min_rating +
            (filters.genre !== '0' ? '&with_genres=' + filters.genre : '') +
            (filters.year_to !== '0' ? '&' + date_field + '.lte=' + filters.year_to + '-12-31' : '') +
            (is_tv ? '&without_genres=' + GENRE_TV_KIDS : '') +
            '&' + date_field + '.gte=' + min_year + '-01-01' +
            '&api_key=' + Lampa.TMDB.key() +
            '&language=' + Lampa.Storage.get('language', 'ru');

        const network = new Lampa.Reguest();

        // Если жанр выбран вручную и он сам по себе детский, отсеивать нечего
        const family_asked = filters.genre === String(GENRE_ANIMATION) || filters.genre === String(GENRE_FAMILY);

        function tag(item) {
            item.source = 'tmdb';
            item.method = method;
            return item;
        }

        function usable(results) {
            if (family_asked) return results.map(tag);

            const grown_up = results.filter(item => {
                const genres = item.genre_ids || [];
                return !(genres.indexOf(GENRE_FAMILY) !== -1 && genres.indexOf(GENRE_ANIMATION) !== -1);
            });
            // Если страница целиком оказалась дошкольной, берём как есть
            return (grown_up.length ? grown_up : results).map(tag);
        }

        // Тянем несколько случайных страниц разом и складываем в общий пул
        function fetchPages(seed) {
            const pages = [];
            while (pages.length < Math.min(DISCOVER_PAGES_PER_FETCH, page_counts[key])) {
                const page = 1 + Math.floor(Math.random() * page_counts[key]);
                if (pages.indexOf(page) === -1) pages.push(page);
            }

            console.log('Lampa Random: Discover', method, '- pages', pages.join(', '), 'of', page_counts[key]);

            let waiting = pages.length;
            let collected = seed ? usable(seed.results || []) : [];

            function done() {
                if (!collected.length) return onFail();
                navigateTo(fillBuffer(key, collected));
            }

            pages.forEach(page => {
                network.silent(Lampa.TMDB.api(query + '&page=' + page), (data) => {
                    collected = collected.concat(usable((data && data.results) || []));
                    if (--waiting === 0) done();
                }, () => {
                    if (--waiting === 0) done();
                });
            });
        }

        // Размер каталога известен — сразу идём за страницами
        if (page_counts[key]) return fetchPages(null);

        network.silent(Lampa.TMDB.api(query + '&page=1'), (first) => {
            page_counts[key] = Math.min(first.total_pages || 1, TMDB_MAX_PAGE);
            persistCache();
            console.log('Lampa Random: Catalogue size cached -', page_counts[key], 'pages for', method);
            fetchPages(first);
        }, onFail);
    }

    // Фильтры экрана «Случайное». Кнопки в шапке ими не пользуются — у них
    // свой, всегда одинаковый режим «просто случайное».
    function menuFilters(is_tv) {
        return {
            genre: stored(is_tv ? 'random_genre_tv' : 'random_genre_movie', '0'),
            year_from: stored('random_year_from', '0'),
            year_to: stored('random_year_to', '0'),
            rating: stored('random_rating', '0')
        };
    }

    function noFilters() {
        return { genre: '0', year_from: '0', year_to: '0', rating: '0' };
    }

    // Случайное из избранного. Карточки там лежат целиком, поэтому фильтры
    // применяем на месте — в отличие от каталога, где этим занимается TMDB.
    function pickFromFavorite(type, filters) {
        const all = Lampa.Favorite.all() || {};

        const seen = {};
        const items = [];

        FAVORITE_LISTS.forEach(list => {
            (all[list] || []).forEach(item => {
                if (!item || !item.id || seen[item.id]) return;
                seen[item.id] = true;
                items.push(item);
            });
        });

        if (!items.length) return Lampa.Noty.show('В избранном пусто');

        const suitable = items.filter(item => {
            if (getMethod(item) !== type) return false;

            if (filters.genre !== '0') {
                const genres = item.genre_ids || [];
                if (genres.indexOf(Number(filters.genre)) === -1) return false;
            }

            const year = Number(String(item.release_date || item.first_air_date || '').slice(0, 4));
            if (filters.year_from !== '0' && (!year || year < Number(filters.year_from))) return false;
            if (filters.year_to !== '0' && (!year || year > Number(filters.year_to))) return false;

            if (filters.rating !== '0' && (item.vote_average || 0) < Number(filters.rating)) return false;

            return true;
        });

        if (!suitable.length) {
            return Lampa.Noty.show('В избранном ничего не подошло под фильтры');
        }

        console.log('Lampa Random: From favorite,', suitable.length, 'of', items.length, 'fit');
        navigateTo(suitable[Math.floor(Math.random() * suitable.length)]);
    }

    function pickRandom(type) {
        random_repeat = () => pickRandom(type);

        const filters = menuFilters(type === 'tv');

        // Избранное человек отбирал руками, поэтому дефолтные пороги года и
        // оценки к нему не применяем — только то, что выбрано явно.
        if (sourceValue() === 'favorite') return pickFromFavorite(type, filters);

        discoverRandom(type, filters, () => {
            Lampa.Noty.show('Ничего не нашлось, попробуйте ослабить фильтры');
        });
    }

    // Кнопка в шапке: внутри списка — случайное из него, иначе из всего каталога
    function runRandom(method) {
        console.log('Lampa Random: Triggered ->', method);

        random_repeat = () => runRandom(method);

        updateQueue();

        const active = Lampa.Activity.active();

        function useQueue() {
            if (queue.length > 0) navigateTo(queue[Math.floor(Math.random() * queue.length)]);
            else console.warn('Lampa Random: No items available.');
        }

        if (!context) {
            console.log('Lampa Random: No list context, using global discover');
            return discoverRandom(method, noFilters(), useQueue);
        }

        if (context.total_pages > 1) {
            const listKey = 'list:' + context.url + ':' + (context.params.genres || '');

            const buffered = takeBuffered(listKey);
            if (buffered) {
                console.log('Lampa Random: From cache,', (buffers[listKey] || []).length, 'left');
                return navigateTo(buffered);
            }

            const maxPages = Math.min(context.total_pages, TMDB_MAX_PAGE);
            const randomPage = Math.floor(Math.random() * maxPages) + 1;

            // Страница уже в памяти — сеть не нужна
            const comp = active && active.activity && active.activity.component;
            if (comp && comp.loaded && comp.loaded[randomPage - 1]) {
                const items = comp.loaded[randomPage - 1];
                if (items && items.length > 0) {
                    console.log('Lampa Random: Using loaded page', randomPage);
                    const pool = preferDecent(items);
                    return navigateTo(pool[Math.floor(Math.random() * pool.length)]);
                }
            }

            const fetchArgs = Object.assign({}, context.params);
            delete fetchArgs.title;
            delete fetchArgs.component;
            delete fetchArgs.card;
            delete fetchArgs.results;
            // Ссылки на саму активность и её вложенные параметры образуют цикл
            delete fetchArgs.activity;
            delete fetchArgs.params;
            fetchArgs.page = randomPage;

            console.log('Lampa Random: Fetching random page', randomPage, 'for', context.url);

            Lampa.Api.list(fetchArgs, (data) => {
                const results = data.results || (Array.isArray(data) ? data : []);
                if (results && results.length > 0) {
                    const pool = preferDecent(results);
                    console.log('Lampa Random: Found', results.length, 'items on page', randomPage, '-', pool.length, 'passed filter');
                    navigateTo(fillBuffer(listKey, pool));
                } else {
                    console.log('Lampa Random: Page empty, falling back to local queue');
                    useQueue();
                }
            }, (err) => {
                console.error('Lampa Random: API error', err);
                useQueue();
            });
        } else {
            console.log('Lampa Random: Single page view, using local queue');
            useQueue();
        }
    }

    // Поля экрана. Жанр зависит от выбранного типа, поэтому список значений —
    // функция, а не готовый объект.
    function screenFields() {
        const is_tv = stored('random_type', 'movie') === 'tv';
        sourceValue();
        return [
            { key: 'random_type', title: 'Тип', values: TYPES, fallback: 'movie' },
            { key: 'random_source', title: 'Где искать', values: SOURCES, fallback: 'catalog' },
            { key: is_tv ? 'random_genre_tv' : 'random_genre_movie', title: 'Жанр', values: is_tv ? GENRES_TV : GENRES_MOVIE, fallback: '0' },
            { key: 'random_year_from', title: 'Год: с', values: YEARS_FROM, fallback: '0' },
            { key: 'random_year_to', title: 'Год: по', values: YEARS_TO, fallback: '0' },
            { key: 'random_rating', title: 'Рейтинг не ниже', values: RATINGS, fallback: '0' }
        ];
    }

    function RandomScreen() {
        const scroll = new Lampa.Scroll({ mask: true, over: true });
        const html = $('<div class="random-screen"></div>');

        this.create = function () {
            this.build();
            return this.render();
        };

        this.build = function () {
            html.empty();

            screenFields().forEach(field => {
                const value = stored(field.key, field.fallback);
                const row = $(
                    '<div class="settings-param selector" data-key="' + field.key + '">' +
                    '<div class="settings-param__name">' + field.title + '</div>' +
                    '<div class="settings-param__value">' + (field.values[value] || field.values[field.fallback]) + '</div>' +
                    '</div>'
                );

                row.on('hover:enter', () => {
                    Lampa.Select.show({
                        title: field.title,
                        items: Object.keys(field.values).map(v => ({
                            title: field.values[v], value: v, selected: v === stored(field.key, field.fallback)
                        })),
                        onSelect: (chosen) => {
                            Lampa.Storage.set(field.key, chosen.value);
                            this.build();
                            this.start();
                        },
                        onBack: () => this.start()
                    });
                });

                html.append(row);
            });

            const button = $('<div class="random-screen__go selector">Показать случайное</div>');
            button.on('hover:enter', () => pickRandom(stored('random_type', 'movie')));
            html.append(button);

            scroll.clear();
            scroll.append(html);
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: () => {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(false, scroll.render());
                },
                up: () => {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: () => Navigator.move('down'),
                left: () => Lampa.Controller.toggle('menu'),
                back: () => Lampa.Activity.backward()
            });
            Lampa.Controller.toggle('content');
        };

        this.render = () => scroll.render();
        this.pause = function () {};
        this.stop = function () {};
        this.destroy = function () {
            scroll.destroy();
            html.remove();
        };
    }

    // Ищем англоязычное название: original_title годится только когда оригинал
    // и так на английском, иначе там турецкое или корейское имя, по которому
    // на YouTube ничего не найдётся.
    function englishTitle(card, method, callback) {
        const original = card.original_title || card.original_name;
        const localized = card.title || card.name;

        if (card.original_language === 'en' && original) return callback(original);

        const url = Lampa.TMDB.api(method + '/' + card.id +
            '?api_key=' + Lampa.TMDB.key() + '&language=en-US');

        new Lampa.Reguest().silent(url, (data) => {
            callback(data.title || data.name || original || localized);
        }, () => {
            callback(original || localized);
        });
    }

    function openYoutubeSearch(query) {
        const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query + ' trailer');
        console.log('Lampa Random: Opening YouTube ->', query + ' trailer');

        const opened = window.open(url, '_blank');
        if (!opened) Lampa.Noty.show('Не удалось открыть YouTube');
    }

    function addTrailerButton(ctx) {
        Core.cardButton(ctx, {
            className: 'button--youtube-trailer',
            icon: '<svg><use xlink:href="#sprite-youtube"></use></svg>',
            title: 'Трейлер',
            after: '.button--play',
            onEnter: () => englishTitle(ctx.card, ctx.method, openYoutubeSearch)
        });
    }

    // Кнопка под постером: пришли сюда «покрутить», а не смотреть, поэтому она
    // же и забирает фокус. Вправо с неё Lampa уводит на «Смотреть» сама — по
    // расположению на экране.
    function addMoreButton(ctx, repeat) {
        const left = Core.cardLeft(ctx);
        if (!left.length || left.find('.random-more').length) return;

        const button = $('<div class="selector random-more">Ещё случайное</div>');
        button.on('hover:enter', repeat);
        left.append(button);

        Lampa.Controller.collectionSet(ctx.render);
        Lampa.Controller.collectionFocus(button[0], ctx.render);
    }

    function addMenuItem() {
        const list = document.querySelector('.menu .menu__list');
        if (!list || document.getElementById('lampa-random-menu')) return;

        // Родной спрайт, как у остальных пунктов меню
        const item = $(
            '<li class="menu__item selector" id="lampa-random-menu">' +
            '<div class="menu__ico"><svg><use xlink:href="#sprite-filter"></use></svg></div>' +
            '<div class="menu__text">Случайное</div>' +
            '</li>'
        );

        // hover:enter покрывает и пульт, и мышь: вешать сюда ещё и click —
        // значит открыть экран дважды
        item.on('hover:enter', () => Lampa.Activity.push({ component: 'random_picker', title: 'Случайное' }));
        $(list).append(item);

        console.log('Lampa Random: Menu item added');
    }

    function addHeadButtons() {
        const actions = document.querySelector('.head__actions');
        if (!actions) return;

        HEAD_BUTTONS.forEach(spec => {
            if (document.getElementById(spec.id)) return;

            // Размеры и отступы даёт сам класс .head__action — свои не навязываем
            const button = $(
                '<div class="head__action selector" id="' + spec.id + '" title="' + spec.title + '">' +
                '<svg><use xlink:href="#' + spec.sprite + '"></use></svg>' +
                '</div>'
            );

            button.on('hover:enter', () => runRandom(spec.type));

            const settings = actions.querySelector('.open--settings');
            if (settings) button.insertBefore(settings);
            else $(actions).append(button);
        });
    }

    function startPlugin() {
        loadCache();
        Lampa.Component.add('random_picker', RandomScreen);

        // Lampa перерисовывает меню и шапку на старте и при смене профиля
        addMenuItem();
        addHeadButtons();
        setInterval(() => {
            addMenuItem();
            addHeadButtons();
        }, 1000);

        Core.onFullCard((ctx) => {
            addTrailerButton(ctx);

            const repeat = random_repeat;
            random_repeat = null;
            if (repeat) addMoreButton(ctx, repeat);
        });

        console.log('Lampa Random: plugin v' + manifest.version + ' ready');
    }

    Core.boot({
        flag: 'lampa_random_plugin',
        manifest: manifest,
        styles: { id: 'lampa-random-styles', css: STYLES },
        start: startPlugin
    });
})();
