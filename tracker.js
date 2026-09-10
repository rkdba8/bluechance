const https = require('https');

const PRODUCT_NAME =
  'Dyson Airwrap Co-anda 2x Straight + Wavy Limited Edition Amber Silk';

const PRODUCT_URL =
  'https://www.coolblue.be/fr/produit/968429/dyson-airwrap-co-anda-2x-straight-wavy-limited-edition-amber-silk.html';

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const DEBUG = process.env.DEBUG === 'true';

function fetchPage(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'fr-BE,fr;q=0.9,nl;q=0.7,en;q=0.5',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache'
        }
      },
      res => {
        const isRedirect = [301, 302, 303, 307, 308].includes(
          res.statusCode
        );

        if (isRedirect && res.headers.location) {
          res.resume();

          if (redirectsLeft <= 0) {
            reject(new Error('Trop de redirections'));
            return;
          }

          const nextUrl = new URL(
            res.headers.location,
            url
          ).toString();

          console.log(
            `Redirection (${res.statusCode}) vers : ${nextUrl}`
          );

          resolve(fetchPage(nextUrl, redirectsLeft - 1));
          return;
        }

        let body = '';

        res.setEncoding('utf8');

        res.on('data', chunk => {
          body += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            body,
            finalUrl: url
          });
        });
      }
    );

    request.setTimeout(15000, () => {
      request.destroy(new Error('Timeout Coolblue'));
    });

    request.on('error', reject);
  });
}

/**
 * Cherche les URL Deuxième Chance.
 *
 * Coolblue utilise actuellement notamment :
 *
 * /fr/produit-deuxieme-chance/3051786
 *
 * qui peut ensuite rediriger vers :
 *
 * /fr/deuxieme-chance-produit/969442/3055275
 */
function extractSecondChanceUrls(html, baseUrl) {
  const urls = new Set();

  // Cherche d'abord les href normaux, relatifs OU absolus.
  const hrefRegex =
    /href=["']([^"']*(?:produit-deuxieme-chance|deuxieme-chance-produit)[^"']*)["']/gi;

  for (const match of html.matchAll(hrefRegex)) {
    const href = match[1].replace(/&amp;/g, '&');

    try {
      const absolute = new URL(href, baseUrl).toString();

      if (
        /\/fr\/(?:produit-deuxieme-chance\/\d+|deuxieme-chance-produit\/\d+\/\d+)/i.test(
          absolute
        )
      ) {
        urls.add(absolute);
      }
    } catch (_) {
      // URL invalide : on ignore.
    }
  }

  // Fallback si Coolblue met l'URL dans du JSON / JavaScript.
  const rawRegex =
    /(?:https:\/\/www\.coolblue\.be)?\/fr\/(?:produit-deuxieme-chance\/\d+|deuxieme-chance-produit\/\d+\/\d+)/gi;

  for (const match of html.matchAll(rawRegex)) {
    try {
      urls.add(new URL(match[0], baseUrl).toString());
    } catch (_) {}
  }

  return [...urls];
}

/**
 * Coolblue représente actuellement les états avec des inputs.
 *
 * On cherche :
 * value="likeNew"
 *
 * ou :
 * aria-label="Non abimé"
 *
 * Puis on vérifie que l'input n'est PAS disabled.
 */
function inspectLikeNew(html) {
  const inputTags =
    html.match(/<input\b[^>]*>/gi) || [];

  const candidates = inputTags.filter(
    tag =>
      /value=["']likeNew["']/i.test(tag) ||
      /aria-label=["']Non abim(?:é|e|&eacute;)["']/i.test(tag)
  );

  if (candidates.length === 0) {
    return {
      present: false,
      available: false,
      tags: []
    };
  }

  const enabled = candidates.filter(
    tag =>
      !/\bdisabled(?:\s*=|\s|>)/i.test(tag)
  );

  return {
    present: true,
    available: enabled.length > 0,
    tags: candidates
  };
}

function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
      reject(
        new Error(
          'TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID manquant'
        )
      );
      return;
    }

    const data = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      disable_web_page_preview: false
    });

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      },
      res => {
        let responseBody = '';

        res.setEncoding('utf8');

        res.on('data', chunk => {
          responseBody += chunk;
        });

        res.on('end', () => {
          if (
            res.statusCode >= 200 &&
            res.statusCode < 300
          ) {
            console.log(
              '✅ Notification Telegram envoyée.'
            );
            resolve();
          } else {
            reject(
              new Error(
                `Telegram HTTP ${res.statusCode}: ${responseBody}`
              )
            );
          }
        });
      }
    );

    req.setTimeout(10000, () => {
      req.destroy(new Error('Timeout Telegram'));
    });

    req.on('error', reject);

    req.write(data);
    req.end();
  });
}

async function run() {
  console.log(`🔎 Vérification : ${PRODUCT_NAME}`);
  console.log(`URL : ${PRODUCT_URL}`);

  const productResponse =
    await fetchPage(PRODUCT_URL);

  console.log(
    `HTTP fiche produit : ${productResponse.statusCode}`
  );

  if (productResponse.statusCode !== 200) {
    throw new Error(
      `Coolblue a répondu HTTP ${productResponse.statusCode}`
    );
  }

  const secondChanceUrls =
    extractSecondChanceUrls(
      productResponse.body,
      PRODUCT_URL
    );

  if (DEBUG) {
    console.log(
      'Liens Deuxième Chance trouvés :',
      secondChanceUrls
    );
  }

  if (secondChanceUrls.length === 0) {
    console.log(
      '❌ Aucun exemplaire Deuxième Chance actuellement relié à cette fiche.'
    );
    return;
  }

  console.log(
    `✅ ${secondChanceUrls.length} lien(s) Deuxième Chance trouvé(s).`
  );

  for (const url of secondChanceUrls) {
    console.log(`Inspection : ${url}`);

    const scResponse = await fetchPage(url);

    console.log(
      `HTTP Deuxième Chance : ${scResponse.statusCode}`
    );

    console.log(
      `URL finale : ${scResponse.finalUrl}`
    );

    if (scResponse.statusCode !== 200) {
      continue;
    }

    const state =
      inspectLikeNew(scResponse.body);

    if (DEBUG) {
      console.log(
        'État Non abimé :',
        state
      );
    }

    if (!state.present) {
      console.log(
        'Option "Non abimé" introuvable.'
      );
      continue;
    }

    if (!state.available) {
      console.log(
        'Option "Non abimé" présente mais indisponible.'
      );
      continue;
    }

    console.log(
      '🎉🎉🎉 NON ABIMÉ DISPONIBLE !'
    );

    await sendTelegramMessage(
      `🎉 DYSON AIRWRAP NON ABIMÉ DISPONIBLE !\n\n` +
      `${PRODUCT_NAME}\n\n` +
      `🔗 ${scResponse.finalUrl}\n\n` +
      `⚡ Ouvre le lien immédiatement !`
    );

    return;
  }

  console.log(
    '❌ Deuxième Chance détectée, mais aucun "Non abimé" disponible.'
  );
}

run().catch(error => {
  console.error('❌ Erreur :', error);
  process.exitCode = 1;
});
