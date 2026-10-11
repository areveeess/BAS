/* Thin client for the BAS Flask API. Every call resolves with the parsed JSON
   body or throws an ApiError carrying a message that is safe to show people. */

export class ApiError extends Error {}

async function request(url, { method = 'GET', json, form, signal } = {}) {
    let response;
    try {
        response = await fetch(url, {
            method,
            signal,
            headers: json ? { 'Content-Type': 'application/json' } : undefined,
            body: json ? JSON.stringify(json) : form,
        });
    } catch (err) {
        if (err.name === 'AbortError') throw err;
        throw new ApiError('Can’t reach the server. Check that it’s running, then try again.');
    }

    let data = null;
    try { data = await response.json(); } catch { /* non-JSON body */ }

    if (!response.ok || !data || data.success === false) {
        throw new ApiError(cleanMessage(data?.description || data?.message) || `The request failed (${response.status}).`);
    }
    return data;
}

/* The import endpoints wrap their own 400s in a 500 ("An error occurred during
   import: 400 Bad Request: CSV missing…"). Show only the useful part. */
function cleanMessage(message) {
    return message ? String(message).replace(/^An error occurred during import:\s*\d{3}\s[^:]+:\s*/i, '') : '';
}

const upload = (url, field, file, signal) => {
    const form = new FormData();
    form.append(field, file);
    return request(url, { method: 'POST', form, signal });
};

export const api = {
    importContainers: (file, signal) => upload('/api/import/containers', 'containersFile', file, signal),
    importItems: (file, signal) => upload('/api/import/items', 'itemsFile', file, signal),
    placement: (signal) => request('/api/placement', { method: 'POST', json: {}, signal }),
    search: (params, signal) => request(`/api/search?${new URLSearchParams(params)}`, { signal }),
    retrieve: (itemId, signal) => request('/api/retrieve', { method: 'POST', json: { itemId: Number(itemId) }, signal }),
    wasteIdentify: (signal) => request('/api/waste/identify', { signal }),
    returnPlan: (body, signal) => request('/api/waste/return-plan', { method: 'POST', json: body, signal }),
    simulate: (body, signal) => request('/api/simulate/day', { method: 'POST', json: body, signal }),
    logs: (params, signal) => request(`/api/logs?${new URLSearchParams(params)}`, { signal }),
};
