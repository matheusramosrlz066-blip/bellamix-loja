const searchInput = document.getElementById("searchInput");
const products = document.querySelectorAll(".product");

searchInput.addEventListener("input", function () {
  const search = searchInput.value.toLowerCase();

  products.forEach(function (product) {
    const name = product.querySelector("h3").textContent.toLowerCase();

    if (name.includes(search)) {
      product.style.display = "block";
    } else {
      product.style.display = "none";
    }
  });
});
