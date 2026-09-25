/**
 * weather — widget renderer. Part of the widgets/ split (P2-10).
 * Classic script: top-level functions become globals.
 */


function renderWeather(widget, container) {
    widget.data = widget.data || {};
    const cfg = widget.config || {};
    const units = cfg.units === 'imperial' ? 'imperial' : 'metric';

    // State for this card instance (not persisted; refreshed on each render).
    let currentData = null;
    let forecastData = null;
    let hourlyData = null;   // T4: next-hours strip
    let lastError = '';      // error message shown in the retry box when fetch fails
    let loading = false;

    const body = document.createElement('div');
    body.className = 'weather-body';
    container.appendChild(body);

    function setLoading(msg) {
        loading = true;
        currentData = null;
        forecastData = null;
        lastError = '';
        renderBody();
        if (msg) body.dataset.status = 'loading';
    }

    function setError(err) {
        loading = false;
        lastError = err || 'Could not load weather.';
        renderBody();
        if (typeof Dashboard.announceStatus === 'function') Dashboard.announceStatus('Weather failed to load: ' + lastError);
    }

    async function fetchWeather(lat, lon) {
        const params = new URLSearchParams({
            latitude: String(lat),
            longitude: String(lon),
            current_weather: 'true',
            timezone: 'auto'
        });
        // T4: request humidity + UV index for the meta row.
        if (cfg.showHumidity !== false) {
            params.set('current', 'relative_humidity_2m,uv_index');
        }
        if (cfg.showForecast !== false) {
            params.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
            params.set('forecast_days', '5');
            // T4: next-hours strip — temperature + precip chance for the coming hours.
            if (cfg.showHourly !== false) {
                params.set('hourly', 'temperature_2m,precipitation_probability,weather_code');
            }
        }
        const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;

        loading = true;
        renderBody();

        try {
            const res = await Dashboard.fetchWithTimeout(url, 10000, { mode: 'cors' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const json = await res.json();
            currentData = json.current_weather || null;
            // T4: merge the `current` block (humidity, UV) into currentData so renderBody
            // can read them alongside temperature/wind. Guard each field — some API
            // responses may omit it.
            if (json.current && typeof json.current === 'object') {
                currentData = Object.assign({}, currentData || {}, json.current);
            }
            forecastData = json.daily || null;
            hourlyData = (cfg.showHourly !== false) ? (json.hourly || null) : null;
            lastError = '';
        } catch (e) {
            console.warn('weather fetch failed', e);
            loading = false;
            setError(e.message || 'Network error');
            return;
        }

        loading = false;
        renderBody();
        // Announce the update to screen readers via the global live region.
        if (typeof Dashboard.announceStatus === 'function') {
            const t = currentData && typeof currentData.temperature === 'number' ? Math.round(currentData.temperature) + '°' : '';
            // NOTE: compute the label here — `cityLabel` is scoped inside renderBody() and
            // would be a ReferenceError if referenced from this outer function.
            const city = (widget.data && widget.data.city) || 'Your Location';
            Dashboard.announceStatus('Weather updated for ' + city + (t ? ', currently ' + t : '') + '.');
        }
    }

    function weatherCodeToText(code) {
        const map = {
            0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
            45: 'Fog', 48: 'Depositing rime fog',
            51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
            61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
            71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snowfall',
            80: 'Slight rain showers', 81: 'Moderate rain showers', 82: 'Violent rain showers',
            95: 'Thunderstorm'
        };
        return map[code] || '';
    }

    function weatherCodeToEmoji(code) {
        const map = {
            0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
            45: '🌫️', 48: '🌫️',
            51: '🌦️', 53: '🌧️', 55: '🌧️',
            61: '🌦️', 63: '🌧️', 65: '⛈️',
            71: '🌨️', 73: '❄️', 75: '❄️',
            80: '🌦️', 81: '🌧️', 82: '⛈️',
            95: '⛈️'
        };
        return map[code] || '🌡️';
    }

    function formatTemp(t) {
        if (t == null || isNaN(t)) return '--°';
        const unit = units === 'imperial' ? 'F' : 'C';
        // Open-Meteo returns metric by default; convert for imperial.
        let value = t;
        if (units === 'imperial') {
            value = t * 9 / 5 + 32;
        }
        return `${Math.round(value)}°${unit}`;
    }

    function renderBody() {
        body.innerHTML = '';

        const cityLabel = widget.data.city || 'Your Location';

        if (loading) {
            const p = document.createElement('p');
            p.className = 'weather-status';
            p.textContent = `Loading weather for ${cityLabel}…`;
            body.appendChild(p);
            return;
        }

        if (lastError) {
            const errBox = document.createElement('div');
            errBox.className = 'weather-error';
            errBox.innerHTML = `
                <p>⚠️ ${escapeHtml(lastError)}</p>
                <button type="button" class="weather-retry-btn">Retry</button>
            `;
            body.appendChild(errBox);
            return;
        }

        if (!currentData) {
            const empty = document.createElement('div');
            empty.className = 'weather-empty';
            empty.innerHTML = `
                <p>No coordinates set yet.</p>
                <button type="button" class="weather-locate-btn">📍 Use my location</button>
                <p style="font-size:12px;opacity:0.7;margin-top:8px;">Or open Edit to enter a city's lat/lon manually.</p>
            `;
            body.appendChild(empty);
            return;
        }

        const main = document.createElement('div');
        main.className = 'weather-main';
        const code = currentData.weather_code || 0;
        main.innerHTML = `
            <div class="weather-icon">${weatherCodeToEmoji(code)}</div>
            <div class="weather-temp">${formatTemp(currentData.temperature)}</div>
            <div class="weather-desc">${escapeHtml(weatherCodeToText(code))}</div>
            <div class="weather-meta">
                ${cfg.showHumidity !== false && currentData.relative_humidity_2m != null ? `<span>💧 ${Math.round(currentData.relative_humidity_2m)}%</span>` : ''}
                ${cfg.showHumidity !== false && currentData.uv_index != null ? `<span>🔆 UV ${currentData.uv_index}</span>` : ''}
                ${currentData.windspeed != null ? `<span>💨 ${Math.round(units === 'imperial' ? currentData.windspeed * 2.23694 : currentData.windspeed)} ${units === 'imperial' ? 'mph' : 'km/h'}</span>` : ''}
                ${currentData.winddirection != null ? `<span>🧭 ${Math.round(currentData.winddirection)}°</span>` : ''}
            </div>
        `;
        body.appendChild(main);

        // T4: compact next-hours strip. Find the current hour index in hourly.time
        // and show the following N hours.
        if (cfg.showHourly !== false &&
            hourlyData && Array.isArray(hourlyData.time) && hourlyData.time.length > 1 &&
            Array.isArray(hourlyData.temperature_2m)) {
            const now = new Date();
            // Build a comparable key (local time, hour precision).
            // NOTE: Open-Meteo returns hourly.time in the API-resolved location's
            // timezone (timezone=auto). This match is correct when the viewer's
            // browser TZ equals that resolved TZ. If a user travels to a different
            // timezone while viewing a saved city, the "current hour" highlight may
            // be off by the offset — acceptable for this app's local-first use case.
            const nowKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}T${String(now.getHours()).padStart(2,'0')}:00`;
            let startIdx = hourlyData.time.findIndex(t => t === nowKey);
            if (startIdx < 0) {
                // Fallback: first entry at or after current time, else index 1.
                startIdx = hourlyData.time.findIndex(t => new Date(t) >= now);
                if (startIdx < 0) startIdx = 1;
            }
            // Show up to the next 8 hours, skipping "now" itself.
            const count = Math.min(8, hourlyData.time.length - startIdx - 1);
            if (count > 0) {
                const strip = document.createElement('div');
                strip.className = 'weather-hourly';
                // P3-7: the hourly times are in the viewer's local timezone
                // (Open-Meteo returns them in the location's TZ, but we render
                // with toLocaleTimeString which uses the browser's TZ). Add a
                // tooltip so users aren't confused when viewing a saved city in
                // a different timezone.
                strip.title = 'Hours shown in your local time';
                for (let i = 0; i < count; i++) {
                    const idx = startIdx + 1 + i;
                    const hLabel = new Date(hourlyData.time[idx]).toLocaleTimeString('en-US', { hour: 'numeric' });
                    const hTemp = formatTemp(hourlyData.temperature_2m ? hourlyData.temperature_2m[idx] : null);
                    const hCode = (hourlyData.weather_code && hourlyData.weather_code[idx]) || 0;
                    let precipHtml = '';
                    if (hourlyData.precipitation_probability != null && hourlyData.precipitation_probability[idx] != null) {
                        const p = Math.round(hourlyData.precipitation_probability[idx]);
                        if (p > 0) precipHtml = `<span class="h-precip">💧${p}%</span>`;
                    }
                    strip.insertAdjacentHTML('beforeend', `
                        <div class="weather-hour">
                            <span class="h-label">${escapeHtml(hLabel)}</span>
                            <span class="h-icon" title="${escapeHtml(weatherCodeToText(hCode))}">${weatherCodeToEmoji(hCode)}</span>
                            <span class="h-temp">${hTemp}</span>
                            ${precipHtml}
                        </div>
                    `);
                }
                body.appendChild(strip);
            }
        }

        if (cfg.showForecast !== false && forecastData && Array.isArray(forecastData.time) && forecastData.time.length > 1) {
            const fc = document.createElement('div');
            fc.className = 'weather-forecast';
            const days = Math.min(5, forecastData.time.length - 1);
            for (let i = 1; i <= days; i++) {
                const dayLabel = new Date(forecastData.time[i]).toLocaleDateString('en-US', { weekday: 'short' });
                const hi = formatTemp(forecastData.temperature_2m_max ? forecastData.temperature_2m_max[i] : null);
                const lo = formatTemp(forecastData.temperature_2m_min ? forecastData.temperature_2m_min[i] : null);
                const dayCode = (forecastData.weather_code && forecastData.weather_code[i]) || 0;
                fc.insertAdjacentHTML('beforeend', `
                    <div class="weather-fc-day">
                        <span class="fc-label">${escapeHtml(dayLabel)}</span>
                        <span class="fc-icon">${weatherCodeToEmoji(dayCode)}</span>
                        <span class="fc-range">${lo} / ${hi}</span>
                    </div>
                `);
            }
            body.appendChild(fc);
        }

        // T12: "Use my location" and "Refresh" buttons moved to the card header.
        // The locate button remains only in the empty-state above (when no coords set).
        // Refresh is triggered via the ↻ icon next to the gear (app.js handleWidgetAction).
    }

    // Button actions.
    // Convention: render functions must not attach listeners to elements they may
    // re-render (the error/empty states are rebuilt by renderBody() after wiring ran,
    // which orphaned the listeners — P1-3). Instead we expose locate/refresh on the
    // widget and let app.js's grid-level delegated click handler dispatch them, the
    // same pattern lists/shortcuts/search already use.
    const locate = () => {
        if (!navigator.geolocation) {
            setError('Geolocation is not supported by this browser.');
            return;
        }
        setLoading();
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                widget.data.lat = pos.coords.latitude;
                widget.data.lon = pos.coords.longitude;
                if (!widget.data.city || widget.data.city === 'Your Location') {
                    // Reverse-geocode via Open-Meteo's free endpoint is not available; keep the label.
                }
                Dashboard.saveFullState();
                fetchWeather(widget.data.lat, widget.data.lon);
            },
            (err) => setError('Location denied: ' + err.message),
            { timeout: 10000 }
        );
    };

    const refresh = () => {
        if (widget.data.lat == null || widget.data.lon == null) {
            locate();
            return;
        }
        fetchWeather(widget.data.lat, widget.data.lon);
    };

    // T12: .weather-refresh-btn no longer exists in the body (moved to header).
    // Expose locate + refresh on the widget so app.js's header ↻ icon and the
    // in-card Retry / "Use my location" buttons (via grid delegation) can call them.
    widget.__weatherLocate = locate;
    widget.__weatherRefresh = refresh;

    renderBody();

    // Auto-fetch if we already have coordinates.
    if (widget.data.lat != null && widget.data.lon != null) {
        fetchWeather(widget.data.lat, widget.data.lon);
    }
}

/**
 * Notes / Scratchpad Widget
 *
 * Data: { text, updatedAt }
 */

// P2-9: publish on the shared namespace.
Dashboard.renderWeather = renderWeather;

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = globalThis.Dashboard;
}
