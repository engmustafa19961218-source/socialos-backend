async function handleAuth() {
  const email = document.getElementById("auth-email").value;
  const password = document.getElementById("auth-password").value;
  const errEl = document.getElementById("auth-error");
  errEl.style.display = "none";
  if (!email || !password) {
    errEl.style.display = "block";
    errEl.textContent = "ادخل البيانات";
    return;
  }
  try {
    const url = isLogin
      ? API + "/api/auth/login"
      : API + "/api/auth/register";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (data.token) {
      currentUser = data.user;
      localStorage.setItem("token", data.token);
      document.getElementById("auth").style.display = "none";
      document.getElementById("dashboard").style.display = "flex";
    } else {
      errEl.style.display = "block";
      errEl.textContent = data.message || "بيانات خاطئة";
    }
  } catch (e) {
    errEl.style.display = "block";
    errEl.textContent = "تعذر الاتصال: " + e.message;
  }
}
