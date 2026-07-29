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

            // 2. Extraction du prix dans le bloc Seconde Chance
            let priceText = "Prix non spécifié";
            const indexChance = html.indexOf(secondChanceUrl);
            
            if (indexChance !== -1) {
                // Zone ciblée autour du lien seconde chance (50 caractères avant, 600 après)
                const start = Math.max(0, indexChance - 50);
                const end = Math.min(html.length, indexChance + 600);
                let sliceHtml = html.substring(start, end);
                
                // Supprimer les prix barrés HTML s'il y en a (tags <del>, class former, etc.)
                sliceHtml = sliceHtml.replace(/<[^>]*class="[^"]*(former|line-through|strike|old)[^"]*"[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
                sliceHtml = sliceHtml.replace(/<(del|s|strike)>[\s\S]*?<\/\1>/gi, '');

                // Nettoyage des balises HTML
                const cleanText = sliceHtml
                    .replace(/<!--[\s\S]*?-->/g, ' ')
                    .replace(/<[^>]*>/g, ' ')
                    .replace(/\s+/g, ' ');

                // Récupérer tous les montants trouvés dans le bloc
                const matches = [...cleanText.matchAll(/(?:€\s*(\d{3,4})|(\d{3,4})\s*€|(\d{3,4})\s*[,-])/g)];
                
                if (matches.length > 0) {
                    const prices = matches
                        .map(m => parseInt(m[1] || m[2] || m[3]))
                        .filter(p => !isNaN(p));

                    if (prices.length > 0) {
                        // Le prix Seconde Chance est toujours le prix le plus bas trouvé
                        const secondChancePrice = Math.min(...prices);
                        priceText = `${secondChancePrice} €`;
                    }
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
