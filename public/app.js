let products=[],cart=[],cat='';

const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});

async function load(){
  const q=document.getElementById('q').value;
  const r=await fetch('/api/products?q='+encodeURIComponent(q)+'&category='+encodeURIComponent(cat));
  products=await r.json();
  render();
}

function category(c){
  cat=c;
  load();
  return false;
}

function render(){
  document.getElementById('grid').innerHTML=products.map((p,i)=>`<article class="card"><div class="pic">${p.image_url?`<img src="${p.image_url}" style="max-width:100%;max-height:100%">`:(p.category==='perfumes'?'🌸':p.category==='cabelos'?'💇':p.category==='unhas'?'💅':p.category==='skincare'?'🧴':'💄')}</div><h3>${p.name}</h3><p>${p.description||''}</p><div class="price">${money(p.price_cents)}</div><small>${p.stock>0?p.stock+' em estoque':'Esgotado'}</small><br><br><button class="buy" ${p.stock<1?'disabled':''} onclick="add(${i})">Adicionar ao carrinho</button></article>`).join('');
}

function add(i){
  const p=products[i];
  const x=cart.find(x=>x.productId===p.id);
  if(x)x.quantity++;
  else cart.push({productId:p.id,name:p.name,price:p.price_cents,quantity:1});
  update();
}

function update(){
  document.getElementById('count').textContent=cart.reduce((s,x)=>s+x.quantity,0);
  document.getElementById('cart').innerHTML=cart.length?cart.map((x,i)=>`<div class="row"><span>${x.name}<br><small>${x.quantity} × ${money(x.price)}</small></span><button onclick="removeItem(${i})">✕</button></div>`).join(''):'<p>Seu carrinho está vazio.</p>';
  document.getElementById('total').textContent=money(cart.reduce((s,x)=>s+x.price*x.quantity,0));
}

function removeItem(i){
  cart.splice(i,1);
  update();
}

function openCart(){
  document.getElementById('drawer').classList.add('open');
  update();
}

function closeCart(){
  document.getElementById('drawer').classList.remove('open');
}

function checkout(){
  if(!cart.length)return alert('Adicione produtos ao carrinho.');
  closeCart();
  document.getElementById('checkout').classList.add('open');
}

function closeCheckout(){
  document.getElementById('checkout').classList.remove('open');
}

async function placeOrder(){location.href='/public/pedido.html?order='+d.orderId;
  const customer={
    name:document.getElementById('name').value.trim(),
    email:document.getElementById('email').value.trim(),
    phone:document.getElementById('phone').value.trim(),
    address:document.getElementById('address').value.trim(),
    city:document.getElementById('city').value.trim(),
    cep:document.getElementById('cep').value.trim()
  };

  if(!customer.name || !customer.email){
    return alert('Informe nome e e-mail.');
  }

  const r=await fetch('/api/orders',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      customer,
      items:cart.map(x=>({
        productId:x.productId,
        quantity:x.quantity
      }))
    })
  });

  const d=await r.json();

  if(!r.ok){
    return alert(d.error||'Erro');
  }

  if(d.checkoutUrl){
    location.href=d.checkoutUrl;
  }else{
    location.href='/pedido.html?order='+d.orderId;
  }
}

load();
update();
