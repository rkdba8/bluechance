const https = require('https');

const PRODUCT_URL = 'https://www.coolblue.be/fr/produit/968427/dyson-airwrap-co-anda-2x-straight-wavy-ceramic-pink.html';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Variable simulant l'état (stocké dans les variables d'environnement ou géré par GitHub)
// Note: Sur GitHub Actions, pour mémoriser l'état d'une exécution à l'autre, 
// on peut utiliser les GitHub Actions Cache ou envoyer un message uniquement si dispo.
// Ici, on envoie une alerte si la page contient la mention "Deuxième Chance".

function fetchPage(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'fr-FR,fr;q=0.9'
            }
        };

        https.get(url, options, (res) => {
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
            'Content-Length': data.length
        }
    };

    const req = https.request(options, (res) => {
        res.on('data', () => {});
    });
    req.write(data);
    req.end();
}

async function run() {
    try {
        console.log("Vérification de la page Coolblue...");
        const response = await fetchPage(PRODUCT_URL);

        if (response.statusCode !== 200) {
            console.log(`Erreur HTTP: ${response.statusCode}`);
            return;
        }

        const html = response.body;
        const available = html.includes('produit-deuxieme-chance') 
                        || html.includes('Deuxième Chance')
                        || html.includes('Seconde chance');

        if (available) {
            const match = html.match(/https:\/\/www\.coolblue\.be\/fr\/produit-deuxieme-chance\/\d+/);
            const secondChanceUrl = match ? match[0] : PRODUCT_URL;

            console.log('🎉 Seconde chance détectée ! Envoi du message Telegram...');
            sendTelegramMessage(
                `🎉 Une version "Seconde Chance" est disponible !\n` +
                `Produit : Dyson Airwrap Co-anda 2x Straight + Wavy Ceramic Pink\n` +
                `${secondChanceUrl}`
            );
        } else {
            console.log('Aucune seconde chance pour le moment.');
        }
    } catch (error) {
        console.error('Erreur lors de l\'exécution :', error);
    }
}

run();
