const https = require('https');

// Liste des produits à surveiller
const PRODUCTS = [
    {
        name: "Dyson Airwrap Co-anda 2x (Amber Silk)",
        url: "https://www.coolblue.be/fr/produit/968429/dyson-airwrap-co-anda-2x-straight-wavy-limited-edition-amber-silk.html"
    },
    {
        name: "Dyson Airwrap Co-anda 2x (Ceramic Pink)",
        url: "https://www.coolblue.be/fr/produit/968427/dyson-airwrap-co-anda-2x-straight-wavy-ceramic-pink.html"
    }
];

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

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

async function checkProduct(product) {
    try {
        console.log(`Vérification : ${product.name}...`);
        const response = await fetchPage(product.url);

        if (response.statusCode !== 200) {
            console.log(`Erreur HTTP Coolblue (${response.statusCode}) pour ${product.name}`);
            return;
        }

        const html = response.body;

        // 1. Détection de la Seconde Chance
        const match = html.match(/https:\/\/www\.coolblue\.be\/fr\/produit-deuxieme-chance\/\d+/);
        const hasSecondChanceActive = html.includes('Deuxième Chance intéressant') || html.includes('Tweede kans');

        if (match && hasSecondChanceActive) {
            const secondChanceUrl = match[0];

            // 2. Extraction du prix découpée depuis l'emplacement du lien
            let priceText = "Prix non spécifié";
            const indexChance = html.indexOf(secondChanceUrl);
            
            if (indexChance !== -1) {
                const sliceHtml = html.substring(indexChance, indexChance + 600);
                const cleanText = sliceHtml.replace(/<[^>]*>/g, '').replace(/<!--[\s\S]*?-->/g, '');
                
                const priceMatch = cleanText.match(/€\s*([0-9\s]+)/);
                if (priceMatch) {
                    const cleanPrice = priceMatch[1].replace(/\s+/g, '');
                    priceText = `${cleanPrice} €`;
                }
            }

            console.log(`🎉 Seconde chance disponible pour ${product.name} ! Envoi Telegram...`);
            sendTelegramMessage(
                `🎉 Une version "Seconde Chance" est DISPONIBLE !\n` +
                `Produit : ${product.name}\n` +
                `💰 Prix : ${priceText}\n` +
                `🔗 Lien : ${secondChanceUrl}`
            );
        } else {
            console.log(`Pas de seconde chance active pour ${product.name}.`);
        }
    } catch (error) {
        console.error(`Erreur lors de l'exécution pour ${product.name} :`, error);
    }
}

async function run() {
    for (const product of PRODUCTS) {
        await checkProduct(product);
    }
}

run();
