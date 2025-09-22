// app-auth.js
export function saveLocalProfile(profile) {
    localStorage.setItem("profile", JSON.stringify(profile));
}

export function loadLocalProfile() {
    const data = localStorage.getItem("profile");
    if (!data) return null; // GEEN pop-ups
    try { return JSON.parse(data); } catch(e){ return null; }
}

export function clearProfile() {
    localStorage.removeItem("profile");
}
