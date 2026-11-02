(() => {
  const year = document.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());

  const nav = document.getElementById("nav");
  const toggle = document.getElementById("navToggle");
  if (nav && toggle) {
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const reveals = document.querySelectorAll(".reveal");
  const markVisible = (el) => el.classList.add("visible");

  reveals.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92) markVisible(el);
  });

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            markVisible(entry.target);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -20px 0px" }
    );
    reveals.forEach((el) => {
      if (!el.classList.contains("visible")) io.observe(el);
    });
  } else {
    reveals.forEach(markVisible);
  }

  // Animated dashboard total
  const counter = document.querySelector(".count-up");
  if (counter) {
    const target = Number(counter.getAttribute("data-target") || "0");
    const duration = 1400;
    const start = performance.now();
    const format = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      counter.textContent = format(target * eased);
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // Subtle phone tilt toward pointer
  const phone = document.getElementById("heroPhone");
  const stage = phone?.parentElement;
  if (phone && stage && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    stage.addEventListener("pointermove", (event) => {
      const rect = stage.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      phone.style.transform = `rotateY(${x * 10}deg) rotateX(${-y * 8}deg)`;
    });
    stage.addEventListener("pointerleave", () => {
      phone.style.transform = "";
    });
  }

  const WHATSAPP_NUMBER = "919850413801";
  const form = document.getElementById("enquiryForm");
  const errorEl = document.getElementById("formError");
  const digitsOnly = (value) => value.replace(/\D/g, "");

  document.querySelectorAll("[data-interest]").forEach((link) => {
    link.addEventListener("click", () => {
      const value = link.getAttribute("data-interest");
      if (form?.interest && value) form.interest.value = value;
    });
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    const name = String(form.name.value || "").trim();
    const phoneValue = String(form.phone.value || "").trim();
    const shop = String(form.shop.value || "").trim();
    const interest = String(form.interest.value || "").trim();
    const message = String(form.message.value || "").trim();
    const phoneDigits = digitsOnly(phoneValue);

    if (!name || phoneDigits.length < 10) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = "Please enter your name and a valid phone number.";
      }
      return;
    }

    const lines = [
      "Hello KDSPOZ / Khise Digital Solution Pvt Ltd,",
      "",
      "I have an enquiry from the website:",
      `• Name: ${name}`,
      `• Phone: ${phoneValue}`,
      shop ? `• Shop: ${shop}` : null,
      `• Interest: ${interest}`,
      message ? `• Message: ${message}` : null,
      "",
      "Please get back to me. Thank you.",
    ].filter(Boolean);

    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank", "noopener,noreferrer");
    form.reset();
  });

  // APK link uses native browser download (href + download attribute).
})();
