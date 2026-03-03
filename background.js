// =============================================
// LEADPILOT BACKGROUND SERVICE WORKER
// Sends lead data to Google Apps Script Web App
// =============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'saveLead') {
        handleSaveLead(request.data, request.selectedTabs, sendResponse);
        return true;
    }
    if (request.action === 'deleteLead') {
        handleDeleteLead(request.linkedinUrls, request.selectedTabs, sendResponse);
        return true;
    }
});

async function handleSaveLead(data, selectedTabs, sendResponse) {
    try {
        const result = await chrome.storage.sync.get(['webAppUrl']);
        const webAppUrl = result.webAppUrl;

        if (!webAppUrl) {
            sendResponse({
                success: false,
                error: 'No Script URL configured. Open LeadPilot popup to set it up.'
            });
            return;
        }

        const payload = {
            firstName: data.firstName || '',
            lastName: data.lastName || '',
            linkedinUrl: data.linkedinUrl || '',
            companyName: data.companyName || '',
            jobTitle: data.jobTitle || '',
            country: data.country || '',
            city: data.city || '',
            companyService: data.companyService || '',
            status: data.status || 'Pending',
            notes: data.notes || '',
            dateAdded: new Date().toLocaleDateString('en-IN'),
            selectedTabs: selectedTabs || []
        };

        const response = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error('Server returned ' + response.status);
        }

        const result2 = await response.json();

        if (result2.status === 'success') {
            sendResponse({ success: true, message: result2.message });
            console.log('[LeadPilot] Lead saved:', data.firstName, data.lastName);
        } else {
            sendResponse({ success: false, error: result2.message || 'Unknown error' });
        }

    } catch (err) {
        console.error('[LeadPilot] Error:', err);
        sendResponse({ success: false, error: err.message });
    }
}

async function handleDeleteLead(linkedinUrls, selectedTabs, sendResponse) {
    try {
        const result = await chrome.storage.sync.get(['webAppUrl']);
        const webAppUrl = result.webAppUrl;
        if (!webAppUrl) {
            sendResponse({ success: false, error: 'No Script URL configured.' });
            return;
        }

        const payload = {
            action: 'delete',
            linkedinUrls: linkedinUrls,
            selectedTabs: selectedTabs || []
        };

        const response = await fetch(webAppUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Server returned ' + response.status);
        const result2 = await response.json();

        if (result2.status === 'success') {
            sendResponse({ success: true, message: result2.message });
            console.log('[LeadPilot] Undo: deleted', linkedinUrls.length, 'leads');
        } else {
            sendResponse({ success: false, error: result2.message || 'Unknown error' });
        }
    } catch (err) {
        console.error('[LeadPilot] Delete error:', err);
        sendResponse({ success: false, error: err.message });
    }
}
