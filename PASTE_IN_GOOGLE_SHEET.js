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

        // Handle delete action (for undo)
        if (data.action === 'delete') {
            return handleDelete(ss, data.linkedinUrls || [], selectedTabs);
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

            // Find LinkedIn URL column
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

            // Get all URL values
            var urlValues = sheet.getRange(2, urlColIndex, lastRow - 1, 1).getValues();

            // Delete rows from bottom to top (so indices don't shift)
            for (var row = urlValues.length - 1; row >= 0; row--) {
                var cellUrl = (urlValues[row][0] || '').toString().trim();
                for (var u = 0; u < linkedinUrls.length; u++) {
                    if (cellUrl === linkedinUrls[u]) {
                        sheet.deleteRow(row + 2); // +2 because row is 0-indexed and we skip header
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

    // Auto-detect name format from existing headers
    var useFullName = false;
    var statusColIndex = -1;
    var industryColIndex = -1;
    var notesColIndex = -1;
    var headers = [];

    if (lastRow > 0 && lastCol > 0) {
        headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        // Check if "Full Name" column exists
        useFullName = headers.some(function (h) {
            return h.toString().toLowerCase().trim() === 'full name';
        });
        // Find Status and Industry columns
        for (var k = 0; k < headers.length; k++) {
            var headerLower = headers[k].toString().toLowerCase().trim();
            if (headerLower === 'status') {
                statusColIndex = k + 1; // 1-indexed
            }
            if (headerLower === 'company service/industry' || headerLower === 'company industry' || headerLower === 'industry') {
                industryColIndex = k + 1;
            }
            if (headerLower === 'notes') {
                notesColIndex = k + 1;
            }
        }
    }

    // If sheet is empty, create headers (default: separate first/last)
    if (lastRow === 0) {
        var newHeaders = [
            'Date Added',
            'First Name',
            'Last Name',
            'LinkedIn URL',
            'Company Name',
            'Job Title',
            'Country',
            'City',
            'Company Service/Industry',
            'Status',
            'Notes'
        ];
        sheet.appendRow(newHeaders);
        sheet.getRange(1, 1, 1, newHeaders.length).setFontWeight('bold');
        useFullName = false;
        industryColIndex = newHeaders.length - 2;
        statusColIndex = newHeaders.length - 1;
        notesColIndex = newHeaders.length;
    }

    // If Industry column doesn't exist on an existing sheet, add it
    if (lastRow > 0 && industryColIndex === -1) {
        lastCol = sheet.getLastColumn();
        var newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('Company Service/Industry').setFontWeight('bold');
        industryColIndex = newCol;
    }

    // If Status column doesn't exist on an existing sheet, add it
    if (lastRow > 0 && statusColIndex === -1) {
        lastCol = sheet.getLastColumn();
        var newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('Status').setFontWeight('bold');
        statusColIndex = newCol;
    }

    // If Notes column doesn't exist on an existing sheet, add it
    if (lastRow > 0 && notesColIndex === -1) {
        lastCol = sheet.getLastColumn();
        var newCol = lastCol + 1;
        sheet.getRange(1, newCol).setValue('Notes').setFontWeight('bold');
        notesColIndex = newCol;
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
            data.status || 'Pending',
            data.notes || ''
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
            data.status || 'Pending',
            data.notes || ''
        ];
    }

    sheet.appendRow(row);

    // Add data validation dropdown on the Status cell
    var newLastRow = sheet.getLastRow();
    if (statusColIndex > 0) {
        var statusCell = sheet.getRange(newLastRow, statusColIndex);
        var rule = SpreadsheetApp.newDataValidation()
            .requireValueInList(['Pending', 'Requested', 'Connected', 'First Message Done', 'Replied', 'In Conversation'], true)
            .setAllowInvalid(false)
            .build();
        statusCell.setDataValidation(rule);

        // Color-code the status cell
        var statusValue = statusCell.getValue();
        applyStatusColor(statusCell, statusValue);
    }
}

function applyStatusColor(cell, status) {
    var colors = {
        'Pending': { bg: '#f1f5f9', fg: '#475569' },
        'Requested': { bg: '#fef3c7', fg: '#92400e' },
        'Connected': { bg: '#d1fae5', fg: '#065f46' },
        'First Message Done': { bg: '#dbeafe', fg: '#1e40af' },
        'Replied': { bg: '#ccfbf1', fg: '#115e59' },
        'In Conversation': { bg: '#ede9fe', fg: '#5b21b6' }
    };
    var c = colors[status];
    if (c) {
        cell.setBackground(c.bg).setFontColor(c.fg).setFontWeight('bold');
    }
}

// =============================================
// AUTO-COLOR ON MANUAL EDIT
// =============================================
// This runs automatically whenever you edit any cell in the sheet.
// If you edit a cell in the "Status" column, it re-applies the color.
function onEdit(e) {
    try {
        var sheet = e.range.getSheet();
        var editedRow = e.range.getRow();
        var editedCol = e.range.getColumn();

        // Skip header row
        if (editedRow <= 1) return;

        // Find the Status column in this sheet
        var lastCol = sheet.getLastColumn();
        if (lastCol === 0) return;
        var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
        var statusColIndex = -1;
        for (var i = 0; i < headers.length; i++) {
            if (headers[i].toString().toLowerCase().trim() === 'status') {
                statusColIndex = i + 1; // 1-indexed
                break;
            }
        }

        // Only act if they edited the Status column
        if (statusColIndex === -1 || editedCol !== statusColIndex) return;

        var newValue = e.range.getValue();
        applyStatusColor(e.range, newValue);
    } catch (err) {
        // Silently ignore errors in onEdit to avoid annoying popups
    }
}

// =============================================
// ONE-TIME SETUP: Apply dropdowns + colors to ALL existing rows
// =============================================
// Run this function ONCE from Apps Script editor (Run → setupStatusDropdowns)
// to add the status dropdown and color to every existing row in every sheet.
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

        // Apply validation + color to every data row
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

        // Also style the header
        sheet.getRange(1, statusColIndex).setFontWeight('bold');
    }

    SpreadsheetApp.getUi().alert('✅ Status dropdowns and colors applied to all ' + sheets.length + ' sheet(s)!');
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
