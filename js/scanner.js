// Lecture de codes-barres avec la caméra du téléphone.
// Utilise l'API native BarcodeDetector (Android/Chrome) et, à défaut (iPhone),
// la bibliothèque ZXing embarquée dans /vendor.

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

let zxingPromise = null;
function loadZXing() {
  if (window.ZXing) return Promise.resolve(window.ZXing);
  zxingPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/zxing.min.js';
    s.onload = () => resolve(window.ZXing);
    s.onerror = () => {
      zxingPromise = null;
      reject(new Error('Impossible de charger le lecteur de codes-barres'));
    };
    document.head.appendChild(s);
  });
  return zxingPromise;
}

async function createDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const formats = FORMATS.filter((f) => supported.includes(f));
      if (formats.length) {
        const detector = new window.BarcodeDetector({ formats });
        return async (video) => {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue || null;
        };
      }
    } catch {
      // On bascule sur ZXing.
    }
  }
  const ZXing = await loadZXing();
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.QR_CODE,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    // On ne lit que la bande centrale : plus rapide et plus fiable.
    const cw = Math.round(w * 0.9);
    const ch = Math.round(h * 0.5);
    canvas.width = cw;
    canvas.height = ch;
    ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
    try {
      const source = new ZXing.HTMLCanvasElementLuminanceSource(canvas);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
      return reader.decode(bitmap).getText();
    } catch {
      return null;
    } finally {
      reader.reset();
    }
  };
}

// Ouvre le scanner plein écran. Renvoie une promesse résolue avec le code lu
// (scanné ou saisi à la main), ou null si l'utilisateur ferme.
export function scanBarcode({ title = 'Scanner un code-barres' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'scanner';
    overlay.innerHTML = `
      <div class="scanner-top">
        <button class="icon-btn light" data-close aria-label="Fermer">✕</button>
        <span>${title}</span>
        <button class="icon-btn light" data-torch aria-label="Lampe" hidden>💡</button>
      </div>
      <div class="scanner-view">
        <video playsinline muted autoplay></video>
        <div class="scanner-frame"><div class="scanner-line"></div></div>
        <p class="scanner-msg">Placez le code-barres dans le cadre</p>
      </div>
      <form class="scanner-manual">
        <input name="code" inputmode="numeric" autocomplete="off" placeholder="…ou tapez le code" />
        <button class="btn primary" type="submit">OK</button>
      </form>`;
    document.body.appendChild(overlay);

    const video = overlay.querySelector('video');
    const msg = overlay.querySelector('.scanner-msg');
    const torchBtn = overlay.querySelector('[data-torch]');
    let stream = null;
    let done = false;
    let timer = null;
    let torchOn = false;

    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      overlay.remove();
      window.removeEventListener('popstate', onBack);
      resolve(code);
    };
    const onBack = () => finish(null);
    window.addEventListener('popstate', onBack);

    overlay.querySelector('[data-close]').onclick = () => finish(null);
    overlay.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const code = e.target.code.value.trim();
      if (code) finish(code);
    };
    torchBtn.onclick = async () => {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      torchOn = !torchOn;
      try {
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      } catch {
        torchBtn.hidden = true;
      }
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        msg.textContent = 'Caméra indisponible ici. Saisissez le code à la main.';
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
      } catch {
        msg.textContent = 'Accès à la caméra refusé. Autorisez-le dans les réglages, ou tapez le code.';
        return;
      }
      if (done) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      const caps = stream.getVideoTracks()[0]?.getCapabilities?.();
      if (caps?.torch) torchBtn.hidden = false;

      let detect;
      try {
        detect = await createDetector();
      } catch (err) {
        msg.textContent = `${err.message}. Tapez le code à la main.`;
        return;
      }
      const tick = async () => {
        if (done) return;
        try {
          const code = await detect(video);
          if (code) {
            navigator.vibrate?.(80);
            finish(code);
            return;
          }
        } catch {
          // image illisible, on réessaie
        }
        timer = setTimeout(tick, 120);
      };
      tick();
    })();
  });
}

// Recherche le produit dans la base libre Open Food Facts (nom, marque, contenance).
export async function lookupProduct(code) {
  if (!/^\d{8,14}$/.test(code)) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_fr,brands,quantity,product_quantity,product_quantity_unit`,
      { signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 1 || !data.product) return null;
    const p = data.product;
    const name = [p.product_name_fr || p.product_name, p.brands?.split(',')[0]].filter(Boolean).join(' – ');
    return { name, ...parseQuantity(p) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function parseQuantity(p) {
  const unitMap = { g: 'g', kg: 'kg', mg: null, ml: 'ml', cl: 'cl', l: 'l', dl: null };
  let qty = Number(p.product_quantity);
  let unit = unitMap[String(p.product_quantity_unit || '').toLowerCase()];
  if (!(qty > 0) || !unit) {
    const m = String(p.quantity || '').match(/([\d.,]+)\s*(kg|g|cl|ml|l)\b/i);
    if (!m) return {};
    qty = Number(m[1].replace(',', '.'));
    unit = m[2].toLowerCase();
  }
  // Valeurs plus lisibles : 1000 g -> 1 kg, 750 ml -> 75 cl
  if (unit === 'g' && qty >= 1000 && qty % 100 === 0) return { qty: qty / 1000, unit: 'kg' };
  if (unit === 'ml' && qty >= 1000 && qty % 100 === 0) return { qty: qty / 1000, unit: 'l' };
  if (unit === 'ml' && qty % 10 === 0) return { qty: qty / 10, unit: 'cl' };
  return { qty, unit };
}
