const API_KEY = "0c7957cac0080768dfbe57fcb8c2b2f0";
const BASE_URL = "https://api.openweathermap.org";
const FAVORITES_KEY = "atmos-favorites";
const UNIT_KEY = "atmos-unit";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

let unit = localStorage.getItem(UNIT_KEY) || "metric";
let currentLocation = null;
let suggestionTimer = null;
let locationRequestLocked = false;
let activeSuggestion = -1;

const elements = {
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#cityInput"),
  suggestions: document.querySelector("#suggestions"),
  status: document.querySelector("#statusMessage"),
  locationButton: document.querySelector("#locationButton"),
  favoriteButton: document.querySelector("#favoriteButton"),
  favoritesList: document.querySelector("#favoritesList"),
};

function setStatus(message = "", type = "loading") {
  elements.status.textContent = message;
  elements.status.className = `status-message${message ? ` visible ${type}` : ""}`;
}

function speedLabel() {
  return unit === "metric" ? "km/h" : "mph";
}

function windSpeed(value) {
  const converted = unit === "metric" ? value * 3.6 : value;
  return `${Math.round(converted)} ${speedLabel()}`;
}

function visibilityLabel(meters) {
  if (unit === "imperial") {
    return `${Math.round(meters / 1609.344)} mi`;
  }
  return `${Math.round(meters / 1000)} km`;
}

function temp(value) {
  return `${Math.round(value)}°`;
}

function iconUrl(code) {
  return `https://openweathermap.org/img/wn/${code}@4x.png`;
}

function formatTime(timestamp, timezoneOffset) {
  const date = new Date((timestamp + timezoneOffset) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function formatHour(timestamp, timezoneOffset) {
  const date = new Date((timestamp + timezoneOffset) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatDay(timestamp, timezoneOffset) {
  const date = new Date((timestamp + timezoneOffset) * 1000);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(date);
}

function weatherTheme(condition) {
  const value = condition.toLowerCase();
  let theme = "clear";
  if (value.includes("rain") || value.includes("drizzle")) theme = "rain";
  else if (value.includes("snow")) theme = "snow";
  else if (value.includes("thunder")) theme = "storm";
  else if (value.includes("cloud") || value.includes("overcast")) theme = "cloud";
  else if (value.includes("mist") || value.includes("fog") || value.includes("haze")) theme = "mist";
  document.documentElement.dataset.weather = theme;
}

async function api(path, params) {
  const url = new URL(`${BASE_URL}${path}`);
  url.search = new URLSearchParams({
    appid: API_KEY,
    units: unit,
    ...params,
  }).toString();
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Unable to load weather data.");
  }
  return data;
}

async function searchLocations(query) {
  if (query.trim().length < 2) {
    elements.suggestions.innerHTML = "";
    elements.suggestions.classList.remove("visible");
    activeSuggestion = -1;
    return;
  }
  try {
    const results = await api("/geo/1.0/direct", { q: query.trim(), limit: "5" });
    elements.suggestions.innerHTML = results.map((item, index) => `
      <button type="button" role="option" data-index="${index}" aria-selected="false">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml([item.state, item.country].filter(Boolean).join(", "))}</span>
      </button>
    `).join("");
    elements.suggestions.classList.toggle("visible", results.length > 0);
    activeSuggestion = -1;
    elements.suggestions.querySelectorAll("button").forEach((button, index) => {
      button.addEventListener("click", () => {
        elements.input.value = `${results[index].name}, ${results[index].country}`;
        elements.suggestions.classList.remove("visible");
        loadWeather(results[index].lat, results[index].lon, results[index].name, results[index].country);
      });
    });
  } catch {
    elements.suggestions.innerHTML = "";
  }
}

function escapeHtml(value) {
  const node = document.createElement("span");
  node.textContent = value;
  return node.innerHTML;
}

async function loadWeather(lat, lon, name = "", country = "") {
  locationRequestLocked = true;
  setStatus("Loading live weather data", "loading");
  try {
    const [current, forecast, air] = await Promise.all([
      api("/data/2.5/weather", { lat, lon }),
      api("/data/2.5/forecast", { lat, lon }),
      api("/data/2.5/air_pollution", { lat, lon }),
    ]);

    currentLocation = {
      lat,
      lon,
      name: name || current.name,
      country: country || current.sys.country,
    };

    renderCurrent(current);
    renderForecast(forecast);
    renderAirQuality(air);
    renderBrief(current, forecast);
    renderFavorites();
    loadWeatherNews();
    setStatus("");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderCurrent(data) {
  const weather = data.weather[0];
  const offset = data.timezone;
  weatherTheme(weather.main);
  document.querySelector("#locationLabel").textContent = `${data.name}, ${data.sys.country}`;
  document.querySelector("#updatedLabel").textContent = `Updated ${formatTime(data.dt, offset)} local time`;
  document.querySelector("#currentTemperature").textContent = temp(data.main.temp);
  document.querySelector("#feelsLike").textContent = `Feels like ${temp(data.main.feels_like)}`;
  document.querySelector("#conditionName").textContent = weather.main;
  document.querySelector("#conditionDetail").textContent = weather.description
    .replace(/\b\w/g, (character) => character.toUpperCase());
  document.querySelector("#weatherIcon").src = iconUrl(weather.icon);
  document.querySelector("#weatherIcon").alt = weather.description;
  document.querySelector("#humidityMetric").textContent = `${data.main.humidity}%`;
  document.querySelector("#windMetric").textContent = windSpeed(data.wind.speed);
  document.querySelector("#visibilityMetric").textContent = visibilityLabel(data.visibility || 0);
  document.querySelector("#pressureMetric").textContent = `${data.main.pressure} hPa`;

  const saved = getFavorites().some((item) => item.lat === currentLocation.lat && item.lon === currentLocation.lon);
  elements.favoriteButton.classList.toggle("active", saved);
  elements.favoriteButton.setAttribute("aria-pressed", String(saved));
  elements.favoriteButton.setAttribute("aria-label", saved ? "Remove location from favorites" : "Add location to favorites");
}

function renderForecast(data) {
  const offset = data.city.timezone;
  const hourly = data.list.slice(0, 8);
  document.querySelector("#hourlyForecast").innerHTML = hourly.map((item, index) => `
    <div class="hourly-item${index === 0 ? " now" : ""}">
      <span>${index === 0 ? "Now" : formatHour(item.dt, offset)}</span>
      <img src="${iconUrl(item.weather[0].icon)}" alt="" />
      <strong>${temp(item.main.temp)}</strong>
      <small>${Math.round(item.pop * 100)}%</small>
    </div>
  `).join("");

  const days = new Map();
  data.list.forEach((item) => {
    const key = formatDay(item.dt, offset);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(item);
  });

  const daily = [...days.entries()].slice(0, 5).map(([day, items]) => {
    const representative = items.reduce((best, item) =>
      item.pop > best.pop ? item : best
    );
    const highs = Math.max(...items.map((item) => item.main.temp_max));
    const lows = Math.min(...items.map((item) => item.main.temp_min));
    return { day, representative, highs, lows };
  });

  document.querySelector("#dailyForecast").innerHTML = daily.map((item, index) => `
    <div class="daily-item">
      <span class="day">${index === 0 ? "Today" : item.day}</span>
      <div class="day-condition">
        <img src="${iconUrl(item.representative.weather[0].icon)}" alt="" />
        <span>${escapeHtml(item.representative.weather[0].main)}</span>
      </div>
      <div class="day-temperature"><strong>${temp(item.highs)}</strong><span>${temp(item.lows)}</span></div>
    </div>
  `).join("");
}

const AQI = [
  { title: "Good", description: "Air quality is satisfactory. Outdoor activity is recommended." },
  { title: "Fair", description: "Air quality is acceptable for most people." },
  { title: "Moderate", description: "Sensitive groups may experience minor discomfort." },
  { title: "Poor", description: "Reduce prolonged or strenuous outdoor activity." },
  { title: "Very Poor", description: "Limit outdoor exposure and follow local health guidance." },
];

function renderAirQuality(data) {
  const item = data.list[0];
  const components = item.components;
  const level = AQI[Math.max(0, item.main.aqi - 1)];
  document.querySelector("#aqiTitle").textContent = level.title;
  document.querySelector("#aqiBadge").textContent = item.main.aqi;
  document.querySelector("#aqiBadge").dataset.level = String(item.main.aqi);
  document.querySelector("#aqiDescription").textContent = level.description;
  document.querySelector("#pm25").textContent = `${components.pm2_5.toFixed(1)} μg`;
  document.querySelector("#pm10").textContent = `${components.pm10.toFixed(1)} μg`;
  document.querySelector("#o3").textContent = `${components.o3.toFixed(1)} μg`;
  document.querySelector(".aqi-scale span").style.width = `${item.main.aqi * 20}%`;
}

function renderBrief(current, forecast) {
  const hours = forecast.list.slice(0, 8);
  const rainChance = Math.round(Math.max(...hours.map((item) => item.pop)) * 100);
  const maxTemp = Math.round(Math.max(...hours.map((item) => item.main.temp)));
  const minTemp = Math.round(Math.min(...hours.map((item) => item.main.temp)));
  const brief = [
    {
      icon: "rain",
      title: rainChance >= 30 ? `${rainChance}% rain chance` : "Low rain risk",
      detail: rainChance >= 30 ? "Keep an umbrella nearby during the next few hours." : "Dry conditions are likely over the coming hours.",
    },
    {
      icon: "temperature",
      title: `${temp(minTemp)} to ${temp(maxTemp)}`,
      detail: "Expected temperature range for the next 24-hour period.",
    },
    {
      icon: "wind",
      title: windSpeed(current.wind.speed),
      detail: current.wind.gust ? `Gusts may reach ${windSpeed(current.wind.gust)}.` : "Current surface wind conditions.",
    },
  ];
  document.querySelector("#weatherBrief").innerHTML = brief.map((item) => `
    <div class="brief-item">
      <span class="brief-icon ${item.icon}" aria-hidden="true"></span>
      <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div>
    </div>
  `).join("");
  renderAdvisory(current, forecast);
}

function renderAdvisory(current, forecast) {
  const rainChance = Math.max(...forecast.list.slice(0, 8).map((item) => item.pop));
  const temperature = current.main.temp;
  const wind = current.wind.speed * (unit === "metric" ? 3.6 : 2.236936);
  const main = current.weather[0].main.toLowerCase();
  let title = "No active advisory detected";
  let detail = "Conditions will be checked whenever weather is refreshed.";

  if (main.includes("thunder")) {
    title = "Thunderstorm alert";
    detail = "Stay indoors and avoid exposed locations until storms pass.";
  } else if (rainChance >= 0.7) {
    title = "High rain probability";
    detail = "Rain is likely during the next forecast window. Plan travel accordingly.";
  } else if (wind >= 50) {
    title = "High wind advisory";
    detail = "Secure loose objects and use extra caution outdoors.";
  } else if (temperature >= (unit === "metric" ? 35 : 95)) {
    title = "High temperature advisory";
    detail = "Hydrate regularly and avoid prolonged exposure to direct heat.";
  } else if (temperature <= (unit === "metric" ? 0 : 32)) {
    title = "Cold weather advisory";
    detail = "Use adequate cold-weather protection and monitor icy surfaces.";
  }
  document.querySelector("#advisoryTitle").textContent = title;
  document.querySelector("#advisoryDetail").textContent = detail;
}

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveFavorites(favorites) {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
  renderFavorites();
}

async function waitForLocation() {
  if (!navigator.geolocation) {
    setStatus("Geolocation is not supported by this browser.", "error");
    return;
  }
  setStatus("Getting your location", "loading");
  navigator.geolocation.getCurrentPosition(
    (position) => {
      if (!locationRequestLocked) {
        loadWeather(position.coords.latitude, position.coords.longitude);
      }
    },
    (error) => {
      if (!locationRequestLocked) {
        setStatus(error.code === 1 ? "Location access was denied. Showing London." : "Location unavailable. Showing London.", "error");
        loadWeather(51.5074, -0.1278, "London", "GB");
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 },
  );
}

function renderFavorites() {
  const favorites = getFavorites();
  if (!favorites.length) {
    elements.favoritesList.innerHTML = '<p class="empty-favorites">Save a location to access it quickly.</p>';
    return;
  }
  elements.favoritesList.innerHTML = favorites.map((item, index) => `
    <button type="button" class="favorite-place" data-index="${index}">
      <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.country)}</small></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </button>
  `).join("");
  elements.favoritesList.querySelectorAll(".favorite-place").forEach((button, index) => {
    button.addEventListener("click", () => {
      const item = favorites[index];
      elements.input.value = `${item.name}, ${item.country}`;
      loadWeather(item.lat, item.lon, item.name, item.country);
    });
  });
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = elements.input.value.trim();
  if (!query) {
    setStatus("Enter a city or location.", "error");
    elements.input.focus();
    return;
  }
  try {
    locationRequestLocked = true;
    setStatus("Searching for location", "loading");
    const [location] = await api("/geo/1.0/direct", { q: query, limit: "1" });
    if (!location) throw new Error("Location not found. Check the spelling and try again.");
    elements.suggestions.classList.remove("visible");
    await loadWeather(location.lat, location.lon, location.name, location.country);
  } catch (error) {
    setStatus(error.message, "error");
  }
});

elements.input.addEventListener("input", () => {
  clearTimeout(suggestionTimer);
  activeSuggestion = -1;
  suggestionTimer = setTimeout(() => searchLocations(elements.input.value), 300);
});

elements.input.addEventListener("keydown", (event) => {
  const options = [...elements.suggestions.querySelectorAll("button")];
  if (!elements.suggestions.classList.contains("visible") || !options.length) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    activeSuggestion = Math.min(activeSuggestion + 1, options.length - 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    activeSuggestion = Math.max(activeSuggestion - 1, 0);
  } else if (event.key === "Enter" && activeSuggestion >= 0) {
    event.preventDefault();
    options[activeSuggestion].click();
    return;
  } else if (event.key === "Escape") {
    elements.suggestions.classList.remove("visible");
    return;
  } else {
    return;
  }
  options.forEach((option, index) => {
    const active = index === activeSuggestion;
    option.setAttribute("aria-selected", String(active));
    if (active) option.scrollIntoView({ block: "nearest" });
  });
});

elements.locationButton.addEventListener("click", waitForLocation);
elements.favoriteButton.addEventListener("click", () => {
  if (!currentLocation) return;
  const favorites = getFavorites();
  const exists = favorites.some((item) => item.lat === currentLocation.lat && item.lon === currentLocation.lon);
  const next = exists
    ? favorites.filter((item) => item.lat !== currentLocation.lat || item.lon !== currentLocation.lon)
    : [...favorites, currentLocation];
  saveFavorites(next);
  const saved = !exists;
  elements.favoriteButton.classList.toggle("active", saved);
  elements.favoriteButton.setAttribute("aria-pressed", String(saved));
});

document.querySelectorAll(".unit-button").forEach((button) => {
  button.classList.toggle("active", button.dataset.unit === unit);
  button.setAttribute("aria-pressed", String(button.dataset.unit === unit));
  button.addEventListener("click", () => {
    unit = button.dataset.unit;
    localStorage.setItem(UNIT_KEY, unit);
    document.querySelectorAll(".unit-button").forEach((item) => {
      const active = item.dataset.unit === unit;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    if (currentLocation) loadWeather(currentLocation.lat, currentLocation.lon, currentLocation.name, currentLocation.country);
  });
});

document.addEventListener("click", (event) => {
  if (!elements.suggestions.contains(event.target) && event.target !== elements.input) {
    elements.suggestions.classList.remove("visible");
  }
});

async function loadWeatherNews() {
  const grid = document.querySelector("#newsGrid");
  const updated = document.querySelector("#newsUpdated");
  try {
    const response = await fetch(`./news.json?cache=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("News feed unavailable");
    const feed = await response.json();
    updated.textContent = feed.updated
      ? `Updated ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(feed.updated))}`
      : "Latest coverage";
    if (!feed.items?.length) throw new Error("No news items available");
    grid.innerHTML = feed.items.slice(0, 6).map((item) => `
      <article class="news-card">
        ${item.image ? `<img src="${escapeHtml(item.image)}" alt="" loading="lazy" />` : '<div class="news-image-placeholder" aria-hidden="true"></div>'}
        <div class="news-card-copy">
          <div class="news-meta"><span>${escapeHtml(item.source)}</span><time datetime="${escapeHtml(item.published)}">${escapeHtml(formatNewsDate(item.published))}</time></div>
          <h3>${escapeHtml(item.title)}</h3>
          ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">Read full story <span aria-hidden="true">↗</span></a>
        </div>
      </article>
    `).join("");
  } catch {
    updated.textContent = "Weather news unavailable";
    grid.innerHTML = '<article class="news-card news-empty"><h3>Latest briefing unavailable</h3><p>Weather conditions remain live. News will refresh automatically at the next update.</p></article>';
  }
}

function formatNewsDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Latest";
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round((date.getTime() - Date.now()) / 86400000),
    "day",
  );
}

renderFavorites();
const savedLocation = getFavorites()[0];
if (savedLocation) {
  elements.input.value = `${savedLocation.name}, ${savedLocation.country}`;
  loadWeather(savedLocation.lat, savedLocation.lon, savedLocation.name, savedLocation.country);
} else {
  waitForLocation();
}
