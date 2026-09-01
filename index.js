const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ===== MD5 Hash Function =====
function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

// ===== Mapping kategori Digiflazz -> kategori DikaPay =====
const CATEGORY_MAP = {
  "Pulsa": "pulsa",
  "Paket Data": "data",
  "Data": "data",
  "PLN": "listrik",
  "PLN Postpaid": "pln-bill",
  "Pascabayar": "pln-bill",
  "PDAM": "pdam",
  "BPJS": "bpjs",
  "Voucher Game": "game",
  "Games": "game",
  "E-Money": "ewallet",
  "E-Wallet": "ewallet",
};

function mapCategory(raw) {
  return CATEGORY_MAP[raw] || "lainnya";
}

// ===== Sync dari Digiflazz =====
async function syncFromDigiflazz() {
  const username = process.env.DIGIFLAZZ_USERNAME;
  const apikey = process.env.DIGIFLAZZ_APIKEY;
  
  if (!username || !apikey) {
    throw new Error("DIGIFLAZZ_USERNAME dan DIGIFLAZZ_APIKEY harus diset di environment variables");
  }

  const sign = md5(username + apikey + "pricelist");

  try {
    const res = await fetch("https://api.digiflazz.com/v1/price-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "prepaid", username, sign }),
    });

    if (!res.ok) {
      throw new Error(`Digiflazz HTTP ${res.status}`);
    }

    const json = await res.json();
    const list = json.data || [];

    // Kelompokkan per kategori DikaPay
    const grouped = {};
    for (const item of list) {
      if (item.buyer_product_status !== true) continue;
      const cat = mapCategory(item.category);
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push({
        sku: item.buyer_sku_code,
        nama: item.product_name,
        brand: item.brand,
        harga_modal: item.price,
        deskripsi: item.desc,
        kategori_asli: item.category,
      });
    }

    grouped["_synced_at"] = new Date().toISOString();
    
    // Simpan ke memory (bisa extend ke database nanti)
    global.productsData = grouped;
    
    return grouped;
  } catch (error) {
    console.error("Sync error:", error);
    throw error;
  }
}

// ===== Routes =====

// Health check
app.get("/", (req, res) => {
  res.json({ status: "DikaPay Digiflazz Proxy Server is running" });
});

// Trigger sync manual
app.post("/sync", async (req, res) => {
  try {
    const data = await syncFromDigiflazz();
    res.json({ ok: true, categories: Object.keys(data).filter(k => !k.startsWith('_')) });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Ambil produk: /products atau /products?category=pulsa
app.get("/products", (req, res) => {
  try {
    if (!global.productsData) {
      return res.status(503).json({ ok: false, error: "Data belum di-sync. Panggil POST /sync dulu" });
    }

    const category = req.query.category;
    const result = category 
      ? { [category]: global.productsData[category] || [] }
      : global.productsData;
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ===== Startup =====
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    console.log("Melakukan initial sync dari Digiflazz...");
    await syncFromDigiflazz();
    console.log("Sync berhasil!");
    
    app.listen(PORT, () => {
      console.log(`DikaPay server jalan di port ${PORT}`);
      console.log(`Endpoint: http://localhost:${PORT}`);
      console.log(`Sync: POST http://localhost:${PORT}/sync`);
      console.log(`Produk: GET http://localhost:${PORT}/products`);
    });
  } catch (error) {
    console.error("Gagal start server:", error);
    process.exit(1);
  }
}

startServer();
