async function placeOrder(){
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
