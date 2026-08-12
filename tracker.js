const https = require('https');

const PRODUCT_NAME = "Dyson Airwrap Co-anda 2x (Amber Silk)";
const PRODUCT_URL = "https://www.coolblue.be/fr/produit/968429/dyson-airwrap-co-anda-2x-straight-wavy-limited-edition-amber-silk.html";
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Passe DEBUG=true en variable d'env pour voir un extrait du HTML autour
// du radio "Non abimé" dans les logs, si jamais le site change de structure.
const DEBUG = process.env.DEBUG === 'true';

function fetchPage(url, redirectsLeft = 5) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'fr-FR,fr;q=0.9'
            }
        };
        https.get(url, options, (res) => {
            // Coolblue répond en 301/302/307/308 sur certaines URLs (par ex.
            // /produit-deuxieme-chance/<id> qui redirige vers l'URL finale
            // avec le slug). On suit la redirection au lieu d'abandonner.
            const isRedirect = [301, 302, 303, 307, 308].includes(res.statusCode);
            if (isRedirect && res.headers.location) {
                res.resume(); // vide la réponse pour libérer le socket
                if (redirectsLeft <= 0) {
                    reject(new Error('Trop de redirections'));
                    return;
                }
                const nextUrl = new URL(res.headers.location, url).toString();
                console.log(`Redirection (${res.statusCode}) vers : ${nextUrl}`);
                resolve(fetchPage(nextUrl, redirectsLeft - 1));
                return;
            }

            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => { resolve({ statusCode: res.statusCode, body: data }); });
        }).on('error', (err) => { reject(err); });
    });
}

function sendTelegramMessage(text) {
    const data = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: text });
    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
        }
    };
    const req = https.request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
            console.log(`Réponse Telegram (Code ${res.statusCode}) :`, responseBody);
        });
    });
    req.on('error', (error) => {
        console.error('Erreur réseau lors de l\'envoi Telegram :', error);
    });
    req.write(data);
    req.end();
}

// Coolblue rend chaque état comme un radio input :
// <input type="radio" aria-label="Non abimé" ... value="likeNew">
// <input type="radio" aria-label="Visiblement endommagé" ... value="visiblyDamaged">
// Le prix affecté à "likeNew" n'est pas dans le HTML statique (il est chargé
// en JS au clic), donc on se base sur la présence du radio "likeNew" et sur
// l'absence de l'attribut "disabled" pour savoir s'il est sélectionnable.
function isLikeNewAvailable(html) {
    // On cherche le tag <input ...> complet qui a aria-label="Non abimé"
    // (l'ordre des attributs peut varier, donc on capture tout le tag).
    const inputRegex = /<input[^>]*aria-label="Non abim[ée]"[^>]*>/i;
    const found = html.match(inputRegex);

    if (!found) {
        return { present: false, disabled: null, raw: null };
    }

    const tag = found[0];
    const disabled = /\bdisabled\b/i.test(tag);

    return { present: true, disabled, raw: tag };
}

async function run() {
    try {
        console.log(`Vérification : ${PRODUCT_NAME}...`);
        const response = await fetchPage(PRODUCT_URL);
        if (response.statusCode !== 200) {
            console.log(`Erreur HTTP Coolblue (${response.statusCode})`);
            return;
        }
        const html = response.body;

        const match = html.match(/https:\/\/www\.coolblue\.be\/fr\/produit-deuxieme-chance\/\d+/);
        if (!match) {
            console.log(`Pas de lien Seconde Chance trouvé pour ${PRODUCT_NAME}.`);
            return;
        }

        const secondChanceUrl = match[0];
        console.log(`Lien Seconde Chance trouvé : ${secondChanceUrl}`);

        const scResponse = await fetchPage(secondChanceUrl);
        if (scResponse.statusCode !== 200) {
            console.log(`Erreur HTTP page Seconde Chance (${scResponse.statusCode})`);
            return;
        }
        const scHtml = scResponse.body;

        if (DEBUG) {
            const idx = scHtml.search(/aria-label="Non abim[ée]"/i);
            console.log('--- DEBUG ---');
            if (idx >= 0) {
                console.log(scHtml.slice(Math.max(0, idx - 300), idx + 300));
            } else {
                console.log('Radio "Non abimé" introuvable dans le HTML.');
            }
            console.log('--- FIN DEBUG ---');
        }

        const state = isLikeNewAvailable(scHtml);

        if (!state.present) {
            console.log(`Option "Non abimé" absente du HTML pour ${PRODUCT_NAME} (peut-être plus proposée du tout).`);
            return;
        }

        if (state.disabled) {
            console.log(`Option "Non abimé" présente mais désactivée (indisponible) pour ${PRODUCT_NAME}.`);
            return;
        }

        console.log(`🎉 Option "Non abimé" disponible/sélectionnable pour ${PRODUCT_NAME} ! Envoi Telegram...`);
        sendTelegramMessage(
            `🎉 Variante "Non abimé" DISPONIBLE en Seconde Chance !\n\n` +
            `Produit : ${PRODUCT_NAME}\n` +
            `🔗 Lien direct : ${secondChanceUrl}\n\n` +
            `(Sélectionne "Non abimé" sur la page pour voir le prix)`
        );

    } catch (error) {
        console.error('Erreur lors de l\'exécution :', error);
    }
}

run();
