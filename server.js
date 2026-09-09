import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { MercadoPagoConfig, Preference, Payment, WebhookSignatureValidator } from 'mercadopago';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const db = new Database(path.join(__dirname, 'data', 'bellamix.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  price_cents INTEGER NOT NULL,
  image_url TEXT DEFAULT '',
  category TEXT DEFAULT 'maquiagem',
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  cep TEXT DEFAULT '',
  subtotal_cents INTEGER NOT NULL,
  shipping_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_id TEXT DEFAULT '',
  preference_id TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);
`);

const seedCount = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (!seedCount) {
  const seed = db.prepare(`INSERT INTO products
    (name, description, price_cents, image_url, category, stock)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const products = [
    ['Gloss Labial Brilho Intenso','Gloss de alto brilho para uso diário.',1990,'','maquiagem',30],
    ['Hidratante Facial','Hidratação leve para todos os tipos de pele.',2990,'','skincare',25],
    ['Sérum Facial','Sérum para rotina de cuidados faciais.',3990,'','skincare',20],
    ['Kit Cuidados com o Cabelo','Shampoo + condicionador + máscara.',5990,'','cabelos',15],
    ['Perfume Feminino','Fragrância floral marcante.',7990,'','perfumes',12],
    ['Kit Maquiagem Completo','Paleta + gloss + itens essenciais.',4990,'','maquiagem',18],
    ['Esmalte Gel','Esmalte de acabamento brilhante.',1490,'','unhas',40],
    ['Kit Spa Facial','Kit para uma rotina de autocuidado.',4490,'','skincare',10]
  ];
  for (const p of products) seed.run(...p);
}

const mpToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const mp = mpToken ? new MercadoPagoConfig({ accessToken: mpToken, options: { timeout: 5000 } }) : null;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000*60*60*8 }
}));
app.use(express.static(__dirname));

const money = c => (c/100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
const shippingFor = subtotal => subtotal >= Math.round(Number(process.env.FREE_SHIPPING_FROM || 199)*100) ? 0 : Math.round(Number(process.env.SHIPPING_PRICE || 14.90)*100);

function adminOnly(req,res,next){
  if (!req.session.admin) return res.status(401).json({error:'Não autorizado'});
  next();
}

app.get('/api/products', (req,res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  let sql = 'SELECT * FROM products WHERE active=1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${q}%`,`%${q}%`); }
  if (category) { sql += ' AND category=?'; params.push(category); }
  sql += ' ORDER BY id DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/products/:id', (req,res) => {
  const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(req.params.id));
  if (!p) return res.status(404).json({error:'Produto não encontrado'});
  res.json(p);
});

app.post('/api/orders', async (req,res) => {
  try {
    const { customer, items } = req.body || {};
    if (!customer?.name || !customer?.email || !Array.isArray(items) || !items.length)
      return res.status(400).json({error:'Informe cliente e produtos.'});

    const ids = items.map(x => Number(x.productId));
    const products = db.prepare(`SELECT * FROM products WHERE active=1 AND id IN (${ids.map(()=>'?').join(',')})`).all(...ids);
    const map = new Map(products.map(p => [p.id,p]));
    const normalized = [];
    for (const item of items) {
      const p = map.get(Number(item.productId));
      const qty = Math.max(1, Math.min(99, Number(item.quantity || 1)));
      if (!p) return res.status(400).json({error:'Produto inválido.'});
      if (p.stock < qty) return res.status(400).json({error:`Estoque insuficiente: ${p.name}`});
      normalized.push({p, qty});
    }

    const subtotal = normalized.reduce((s,x)=>s+x.p.price_cents*x.qty,0);
    const shipping = shippingFor(subtotal);
    const total = subtotal + shipping;

    const tx = db.transaction(() => {
      const order = db.prepare(`INSERT INTO orders
        (customer_name,email,phone,address,city,cep,subtotal_cents,shipping_cents,total_cents)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(
          customer.name.trim(), customer.email.trim().toLowerCase(), customer.phone||'',
          customer.address||'', customer.city||'', customer.cep||'', subtotal, shipping, total
      );
      const addItem = db.prepare(`INSERT INTO order_items
        (order_id,product_id,product_name,unit_price_cents,quantity) VALUES (?,?,?,?,?)`);
      const reduce = db.prepare('UPDATE products SET stock=stock-? WHERE id=?');
      for (const x of normalized) {
        addItem.run(order.lastInsertRowid,x.p.id,x.p.name,x.p.price_cents,x.qty);
        reduce.run(x.qty,x.p.id);
      }
      return Number(order.lastInsertRowid);
    });
    const orderId = tx();

    if (!mp) return res.json({ orderId, checkoutUrl: null, paymentConfigured:false });

    const preference = new Preference(mp);
    const base = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/,'');
    const pref = await preference.create({
      body: {
        external_reference: String(orderId),
        items: normalized.map(x => ({
          id: String(x.p.id),
          title: x.p.name,
          quantity: x.qty,
          currency_id: 'BRL',
          unit_price: x.p.price_cents / 100
        })),
        payer: { name: customer.name, email: customer.email },
        back_urls: {
          success: `${base}/pedido.html?order=${orderId}&status=success`,
          pending: `${base}/pedido.html?order=${orderId}&status=pending`,
          failure: `${base}/pedido.html?order=${orderId}&status=failure`
        },
        auto_return: 'approved',
        notification_url: `${base}/api/payments/webhook`
      }
    });
    db.prepare('UPDATE orders SET preference_id=? WHERE id=?').run(pref.id, orderId);
    res.json({orderId, checkoutUrl: pref.init_point, paymentConfigured:true});
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'Não foi possível criar o pedido.'});
  }
});

app.get('/api/orders/:id', (req,res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));
  if (!order) return res.status(404).json({error:'Pedido não encontrado'});
  const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(order.id);
  res.json({...order, items});
});

app.post('/api/payments/webhook', async (req,res) => {
  try {
    if (!mp) return res.sendStatus(200);
    const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (secret) {
      try {
        WebhookSignatureValidator.validate({
          xSignature: req.headers['x-signature'],
          xRequestId: req.headers['x-request-id'],
          dataId: req.query['data.id'],
          secret
        });
      } catch {
        return res.sendStatus(401);
      }
    }
    res.sendStatus(200);
    const type = req.body?.type || req.body?.topic;
    const paymentId = req.body?.data?.id || (type === 'payment' ? req.body?.id : null);
    if (type !== 'payment' || !paymentId) return;
    const paymentClient = new Payment(mp);
    const payment = await paymentClient.get({id: String(paymentId)});
    const orderId = Number(payment.external_reference);
    if (!orderId) return;
    const current = db.prepare('SELECT status FROM orders WHERE id=?').get(orderId);
    if (!current) return;
    const status = payment.status === 'approved' ? 'paid' :
                   payment.status === 'pending' ? 'pending' :
                   ['rejected','cancelled'].includes(payment.status) ? 'cancelled' : 'pending';
    db.prepare('UPDATE orders SET status=?, payment_id=? WHERE id=?').run(status,String(paymentId),orderId);
  } catch(e) { console.error('Webhook:',e); }
});

app.post('/api/admin/login', async (req,res) => {
  const {email,password} = req.body || {};
  const expected = process.env.ADMIN_EMAIL || 'admin@seudominio.com.br';
  const hash = process.env.ADMIN_PASSWORD_HASH || '';
  if (email !== expected || !hash || !(await bcrypt.compare(password || '', hash)))
    return res.status(401).json({error:'Login inválido'});
  req.session.admin = true;
  res.json({ok:true});
});
app.post('/api/admin/logout', (req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/admin/me',(req,res)=>res.json({admin:!!req.session.admin}));

app.get('/api/admin/stats', adminOnly, (req,res)=>{
  const orders = db.prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN status IN ('paid','processing','shipped','delivered') THEN total_cents ELSE 0 END),0) AS revenue_cents FROM orders`).get();
  const products = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN active=1 THEN 1 ELSE 0 END),0) AS active, COALESCE(SUM(CASE WHEN active=1 AND stock<=5 THEN 1 ELSE 0 END),0) AS low_stock FROM products`).get();
  const pending = db.prepare(`SELECT COUNT(*) AS count FROM orders WHERE status IN ('pending','paid','processing','shipped')`).get();
  res.json({orders,products,pending});
});
app.get('/api/admin/products', adminOnly, (req,res)=>res.json(db.prepare('SELECT * FROM products ORDER BY id DESC').all()));
app.post('/api/admin/products', adminOnly, (req,res)=>{
  const p=req.body||{};
  const result=db.prepare(`INSERT INTO products(name,description,price_cents,image_url,category,stock,active)
    VALUES(?,?,?,?,?,?,?)`).run(p.name, p.description||'', Math.round(Number(p.price)*100), p.image_url||'', p.category||'maquiagem', Number(p.stock||0), p.active===false?0:1);
  res.json({id:Number(result.lastInsertRowid)});
});
app.put('/api/admin/products/:id', adminOnly, (req,res)=>{
  const p=req.body||{};
  db.prepare(`UPDATE products SET name=?,description=?,price_cents=?,image_url=?,category=?,stock=?,active=? WHERE id=?`)
    .run(p.name,p.description||'',Math.round(Number(p.price)*100),p.image_url||'',p.category||'maquiagem',Number(p.stock||0),p.active?1:0,Number(req.params.id));
  res.json({ok:true});
});
app.delete('/api/admin/products/:id', adminOnly, (req,res)=>{
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(Number(req.params.id)); res.json({ok:true});
});
app.get('/api/admin/orders', adminOnly, (req,res)=>{
  const orders=db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const getItems=db.prepare('SELECT * FROM order_items WHERE order_id=?');
  res.json(orders.map(o=>({...o,items:getItems.all(o.id)})));
});
app.patch('/api/admin/orders/:id', adminOnly, (req,res)=>{
  const allowed=['pending','paid','processing','shipped','delivered','cancelled'];
  if(!allowed.includes(req.body.status)) return res.status(400).json({error:'Status inválido'});
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(req.body.status,Number(req.params.id));
  res.json({ok:true});
});

app.get('/admin', (req,res)=>res.sendFile(path.join(__dirname,'public','admin.html')));
app.get('/health', (req,res)=>res.json({ok:true,store:process.env.STORE_NAME||'BellaMix Cosméticos'}));

app.listen(PORT,()=>console.log(`BellaMix rodando em http://localhost:${PORT}`));
