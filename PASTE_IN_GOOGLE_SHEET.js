// =============================================
// LEADPILOT — Google Apps Script v3
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

        // Handle delete action (for undo)
        if (data.action === 'delete') {
            return handleDelete(ss, data.linkedinUrls || [], selectedTabs);
        }

        // Handle getTabs action (fetch sheet tab names)
        if (data.action === 'getTabs') {
            var sheets = ss.getSheets();
            var sheetNames = sheets.map(function(s) { return s.getName(); });
            return ContentService
                .createTextOutput(JSON.stringify({
                    status: 'success',
                    sheets: sheetNames
                }))
                .setMimeType(ContentService.MimeType.JSON);
        }

        // Determine target sheets
        var targetSheets = [];

        if (selectedTabs.length > 0) {
            for (var i = 0; i < selectedTabs.length; i++) {
                var tabName = selectedTabs[i];
                var sheet = ss.getSheetByName(tabName);
                if (!sheet) {
                    sheet = ss.insertSheet(tabName);
                }
                targetSheets.push(sheet);
            }
        } else {
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

// Delete rows by LinkedIn URL (for undo functionality)
function handleDelete(ss, linkedinUrls, selectedTabs) {
    try {
        var targetSheets = [];
        if (selectedTabs.length > 0) {
            for (var i = 0; i < selectedTabs.length; i++) {
                var sheet = ss.getSheetByName(selectedTabs[i]);
                if (sheet) targetSheets.push(sheet);
            }
        } else {
            targetSheets.push(ss.getSheets()[0]);
        }

        var totalDeleted = 0;
        for (var s = 0; s < targetSheets.length; s++) {
            var sheet = targetSheets[s];
            var lastRow = sheet.getLastRow();
            var lastCol = sheet.getLastColumn();
            if (lastRow <= 1 || lastCol === 0) continue;

            // Find LinkedIn URL column (Sales Navigator URL used as unique identifier)
            var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
            var urlColIndex = -1;
            for (var k = 0; k < headers.length; k++) {
                var h = headers[k].toString().toLowerCase().trim();
                if (h === 'linkedin url' || h === 'linkedinurl' || h === 'linkedin') {
                    urlColIndex = k + 1;
                    break;
                }
            }
            if (urlColIndex === -1) continue;

            // Get formulas (cells with HYPERLINK formula) and plain values as fallback
            var urlFormulas = sheet.getRange(2, urlColIndex, lastRow - 1, 1).getFormulas();
            var urlValues = sheet.getRange(2, urlColIndex, lastRow - 1, 1).getValues();

            // Delete rows from bottom to top (so indices don't shift)
            for (var row = urlFormulas.length - 1; row >= 0; row--) {
                // Extract URL from HYPERLINK formula if present, else use plain value
                var raw = urlFormulas[row][0] || '';
                var cellUrl = raw.match(/HYPERLINK\("([^"]+)"/i)?.[1] ||
                              (urlValues[row][0] || '').toString().trim();

                for (var u = 0; u < linkedinUrls.length; u++) {
                    if (cellUrl === linkedinUrls[u]) {
                        sheet.deleteRow(row + 2); // +2: 0-indexed + skip header
                        totalDeleted++;
                        break;
                    }
                }
            }
        }

        return ContentService
            .createTextOutput(JSON.stringify({
                status: 'success',
                message: 'Deleted ' + totalDeleted + ' row(s)'
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
    var lastCol = sheet.getLastColumn();

    var useFullName = false;
    var statusColIndex = -1;
    var industryColIndex = -1;
    var notesColIndex = -1;
    var urlColIndex = -1;
    var profileUrlColIndex = -1;
    var headers = [];

    if (lastRow > 0 && lastCol > 0) {
        headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        useFullName = headers.some(function(h) {
            return h.toString().toLowerCase().trim() === 'full name';
        });
        for (var k = 0; k < headers.length; k++) {
            var headerLower = headers[k].toString().toLowerCase().trim();
            if (headerLower === 'status') statusColIndex = k + 1;
            if (headerLower === 'company service/industry' || headerLower === 'company industry' || headerLower === 'industry') industryColIndex = k + 1;
            if (headerLower === 'notes') notesColIndex = k + 1;
            if (headerLower === 'linkedin url' || headerLower === 'linkedinurl' || headerLower === 'linkedin') urlColIndex = k + 1;
            if (headerLower === 'linkedin profile url' || headerLower === 'profile url') profileUrlColIndex = k + 1;
        }
    }

    // If sheet is empty, create headers
    if (lastRow === 0) {
        var newHeaders = [
            'Date Added',
            'First Name',
            'Last Name',
            'LinkedIn URL',
            'LinkedIn Profile URL',
            'Company Name',
            'Job Title',
            'Country',
            'City',
            'Company Service/Industry',
            'Status',
            'Notes'
        ];
        sheet.appendRow(newHeaders);

        // Style header row
        var hdr = sheet.getRange(1, 1, 1, newHeaders.length);
        hdr.setBackground('#1e293b').setFontColor('#ffffff').setFontWeight('bold');
        sheet.setFrozenRows(1);

        // Column widths
        var widths = [90, 110, 110, 110, 110, 150, 160, 85, 100, 150, 120, 190];
        for (var w = 0; w < widths.length; w++) {
            try { sheet.setColumnWidth(w + 1, widths[w]); } catch(e) {}
        }

        useFullName = false;
        urlColIndex = 4;
        profileUrlColIndex = 5;
        industryColIndex = 10;
        statusColIndex = 11;
        notesColIndex = 12;
        lastRow = 1; // header row now exists
    }

    // Auto-add missing columns to existing sheets
    if (industryColIndex === -1) {
        lastCol = sheet.getLastColumn();
        var newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('Company Service/Industry').setFontWeight('bold');
        industryColIndex = newCol;
    }
    if (statusColIndex === -1) {
        lastCol = sheet.getLastColumn();
        var newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('Status').setFontWeight('bold');
        statusColIndex = newCol;
    }
    if (notesColIndex === -1) {
        lastCol = sheet.getLastColumn();
        var newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('Notes').setFontWeight('bold');
        notesColIndex = newCol;
    }
    if (profileUrlColIndex === -1) {
        lastCol = sheet.getLastColumn();
        var newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('LinkedIn Profile URL').setFontWeight('bold');
        profileUrlColIndex = newCol;
    }

    // Build the data row — URL columns use '' placeholder (set via setFormula below)
    var row;
    if (useFullName) {
        var fullName = ((data.firstName || '') + ' ' + (data.lastName || '')).trim();
        row = [
            data.dateAdded || new Date().toLocaleDateString(),
            fullName,
            '',  // LinkedIn URL placeholder (set via formula)
            '',  // LinkedIn Profile URL placeholder (set via formula)
            data.companyName || '',
            data.jobTitle || '',
            data.country || '',
            data.city || '',
            data.companyService || '',
            data.status || 'Pending',
            data.notes || ''
        ];
    } else {
        row = [
            data.dateAdded || new Date().toLocaleDateString(),
            data.firstName || '',
            data.lastName || '',
            '',  // LinkedIn URL placeholder (set via formula)
            '',  // LinkedIn Profile URL placeholder (set via formula)
            data.companyName || '',
            data.jobTitle || '',
            data.country || '',
            data.city || '',
            data.companyService || '',
            data.status || 'Pending',
            data.notes || ''
        ];
    }

    sheet.appendRow(row);
    var newLastRow = sheet.getLastRow();

    // Set LinkedIn URL as HYPERLINK formula
    try {
        if (urlColIndex > 0 && data.linkedinUrl) {
            sheet.getRange(newLastRow, urlColIndex)
                .setFormula('=HYPERLINK("' + data.linkedinUrl + '","Sales Nav")');
        }
        if (profileUrlColIndex > 0 && data.linkedinProfileUrl) {
            sheet.getRange(newLastRow, profileUrlColIndex)
                .setFormula('=HYPERLINK("' + data.linkedinProfileUrl + '","LinkedIn")');
        }
    } catch(formulaErr) {
        // If formula fails, set plain text
        if (urlColIndex > 0 && data.linkedinUrl) {
            sheet.getRange(newLastRow, urlColIndex).setValue(data.linkedinUrl);
        }
        if (profileUrlColIndex > 0 && data.linkedinProfileUrl) {
            sheet.getRange(newLastRow, profileUrlColIndex).setValue(data.linkedinProfileUrl);
        }
    }

    // Add data validation dropdown on Status cell + apply color coding
    try {
        if (statusColIndex > 0) {
            var statusCell = sheet.getRange(newLastRow, statusColIndex);
            var rule = SpreadsheetApp.newDataValidation()
                .requireValueInList(['Pending', 'Requested', 'Connected', 'First Message Done', 'Replied', 'In Conversation'], true)
                .setAllowInvalid(true)
                .build();
            statusCell.setDataValidation(rule);
            var statusValue = statusCell.getValue();
            if (statusValue) applyStatusColor(statusCell, statusValue);
        }
    } catch (formatErr) {
        // Data saved above — formatting is non-critical
    }
}

function applyStatusColor(cell, status) {
    var colors = {
        'Pending':            { bg: '#f1f5f9', fg: '#475569' },
        'Requested':          { bg: '#fef3c7', fg: '#92400e' },
        'Connected':          { bg: '#d1fae5', fg: '#065f46' },
        'First Message Done': { bg: '#dbeafe', fg: '#1e40af' },
        'Replied':            { bg: '#ccfbf1', fg: '#115e59' },
        'In Conversation':    { bg: '#ede9fe', fg: '#5b21b6' }
    };
    var c = colors[status];
    if (c) cell.setBackground(c.bg).setFontColor(c.fg).setFontWeight('bold');
}

// =============================================
// AUTO-COLOR ON MANUAL EDIT
// =============================================
function onEdit(e) {
    try {
        var sheet = e.range.getSheet();
        var editedRow = e.range.getRow();
        var editedCol = e.range.getColumn();
        if (editedRow <= 1) return;

        var lastCol = sheet.getLastColumn();
        if (lastCol === 0) return;
        var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        var statusColIndex = -1;
        for (var i = 0; i < headers.length; i++) {
            if (headers[i].toString().toLowerCase().trim() === 'status') {
                statusColIndex = i + 1;
                break;
            }
        }
        if (statusColIndex === -1 || editedCol !== statusColIndex) return;
        applyStatusColor(e.range, e.range.getValue());
    } catch (err) {
        // Silently ignore
    }
}

// =============================================
// ONE-TIME SETUP: Apply dropdowns + colors to ALL existing rows
// =============================================
function setupStatusDropdowns() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = ss.getSheets();
    var statusList = ['Pending', 'Requested', 'Connected', 'First Message Done', 'Replied', 'In Conversation'];

    for (var s = 0; s < sheets.length; s++) {
        var sheet = sheets[s];
        var lastRow = sheet.getLastRow();
        var lastCol = sheet.getLastColumn();
        if (lastRow <= 1 || lastCol === 0) continue;

        var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        var statusColIndex = -1;
        for (var i = 0; i < headers.length; i++) {
            if (headers[i].toString().toLowerCase().trim() === 'status') {
                statusColIndex = i + 1;
                break;
            }
        }
        if (statusColIndex === -1) continue;

        var rule = SpreadsheetApp.newDataValidation()
            .requireValueInList(statusList, true)
            .setAllowInvalid(false)
            .build();

        for (var row = 2; row <= lastRow; row++) {
            var cell = sheet.getRange(row, statusColIndex);
            cell.setDataValidation(rule);
            var val = cell.getValue();
            if (val) applyStatusColor(cell, val);
        }
        sheet.getRange(1, statusColIndex).setFontWeight('bold');
    }

    SpreadsheetApp.getUi().alert('Status dropdowns and colors applied to all ' + sheets.length + ' sheet(s)!');
}

function doGet(e) {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheets = ss.getSheets();
        var sheetNames = sheets.map(function(s) { return s.getName(); });
        return ContentService
            .createTextOutput(JSON.stringify({
                status: 'ok',
                message: 'LeadPilot Script is running!',
                sheets: sheetNames
            }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (error) {
        return ContentService
            .createTextOutput(JSON.stringify({ status: 'ok', message: 'LeadPilot Script is running!' }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}
