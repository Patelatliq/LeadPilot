// =============================================
// LEADPILOT — Google Apps Script
// Paste this in your Google Sheet's Apps Script
// =============================================
// 
// STEPS:
// 1. Open your Google Sheet
// 2. Go to Extensions → Apps Script
// 3. Delete any existing code
// 4. Paste ALL the code below
// 5. Click Deploy → New Deployment
// 6. Type = "Web app"
// 7. Execute as = "Me"
// 8. Who has access = "Anyone"
// 9. Click Deploy → Copy the URL
// 10. Paste URL in the LeadPilot popup
//
// =============================================

function doPost(e) {
    try {
        var data = JSON.parse(e.postData.contents);
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var selectedTabs = data.selectedTabs || [];

        // Determine target sheets
        var targetSheets = [];

        if (selectedTabs.length > 0) {
            for (var i = 0; i < selectedTabs.length; i++) {
                var tabName = selectedTabs[i];
                var sheet = ss.getSheetByName(tabName);
                if (!sheet) {
                    // Auto-create the tab if it doesn't exist
                    sheet = ss.insertSheet(tabName);
                }
                targetSheets.push(sheet);
            }
        } else {
            // Default: use the first sheet
            targetSheets.push(ss.getSheets()[0]);
        }

        // Write to each target sheet
        var writtenTo = [];
        for (var j = 0; j < targetSheets.length; j++) {
            var sheet = targetSheets[j];
            writeLeadToSheet(sheet, data);
            writtenTo.push(sheet.getName());
        }

        return ContentService
            .createTextOutput(JSON.stringify({
                status: 'success',
                message: 'Saved to: ' + writtenTo.join(', ')
            }))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function writeLeadToSheet(sheet, data) {
    var lastRow = sheet.getLastRow();

    // Auto-detect name format from existing headers
    var useFullName = false;
    if (lastRow > 0) {
        var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        // Check if "Full Name" column exists
        useFullName = headers.some(function (h) {
            return h.toString().toLowerCase().trim() === 'full name';
        });
    }

    // If sheet is empty, create headers (default: separate first/last)
    if (lastRow === 0) {
        var headers = [
            'Date Added',
            'First Name',
            'Last Name',
            'LinkedIn URL',
            'Company Name',
            'Job Title',
            'Country',
            'City',
            'Company Service/Industry',
            'Status'
        ];
        sheet.appendRow(headers);
        sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
        useFullName = false;
    }

    // Build the data row
    var row;
    if (useFullName) {
        var fullName = ((data.firstName || '') + ' ' + (data.lastName || '')).trim();
        row = [
            data.dateAdded || new Date().toLocaleDateString(),
            fullName,
            data.linkedinUrl || '',
            data.companyName || '',
            data.jobTitle || '',
            data.country || '',
            data.city || '',
            data.companyService || '',
            data.status || 'New'
        ];
    } else {
        row = [
            data.dateAdded || new Date().toLocaleDateString(),
            data.firstName || '',
            data.lastName || '',
            data.linkedinUrl || '',
            data.companyName || '',
            data.jobTitle || '',
            data.country || '',
            data.city || '',
            data.companyService || '',
            data.status || 'New'
        ];
    }

    sheet.appendRow(row);
}

function doGet(e) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheets = ss.getSheets();
        var sheetNames = sheets.map(function (s) { return s.getName(); });
        return ContentService
            .createTextOutput(JSON.stringify({
                status: 'ok',
                message: 'LeadPilot Script is running!',
                sheets: sheetNames
            }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({
                status: 'ok',
                message: 'LeadPilot Script is running!'
            }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}
