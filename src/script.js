"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var googleapis_1 = require("googleapis");
var dotenv = require("dotenv");
dotenv.config();
// Shortcut API configuration
var SHORTCUT_API_TOKEN = process.env.SHORTCUT_API_TOKEN;
var SHORTCUT_API_URL = 'https://api.app.shortcut.com/api/v3/search/stories';
var SHORTCUT_GROUPS_API_URL = 'https://api.app.shortcut.com/api/v3/groups';
var SHORTCUT_CUSTOM_FIELDS_API_URL = 'https://api.app.shortcut.com/api/v3/custom-fields';
// Google Sheets API configuration
var GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
var GOOGLE_SHEETS_RANGE = 'Sheet1!A1';
var GOOGLE_CREDENTIALS_BASE64 = process.env.GOOGLE_CREDENTIALS_BASE64;
// Function to get the date six months ago
var getDateSixMonthsAgo = function () {
    var date = new Date();
    date.setMonth(date.getMonth() - 6);
    return date.toISOString().split('T')[0];
};
// Function to get all bug-type cards from Shortcut with pagination
var getAllBugCardsFromShortcut = function () { return __awaiter(void 0, void 0, void 0, function () {
    var query, allBugs, next, url, response, data, error_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                query = "type:bug !is:archived !is:done";
                allBugs = [];
                next = null;
                _a.label = 1;
            case 1:
                _a.trys.push([1, 7, , 8]);
                _a.label = 2;
            case 2:
                url = next ? new URL(next, SHORTCUT_API_URL).href : "".concat(SHORTCUT_API_URL, "?query=").concat(encodeURIComponent(query));
                console.log("Fetching URL: ".concat(url)); // Debugging log
                // Break the loop if the next parameter contains a specific pattern
                if (next && next.includes('page_size=1')) {
                    console.log("Next parameter ", next);
                    console.log('Breaking the loop to avoid 400 error');
                    return [3 /*break*/, 6];
                }
                return [4 /*yield*/, fetch(url, {
                        headers: {
                            'Shortcut-Token': SHORTCUT_API_TOKEN || '',
                        },
                    })];
            case 3:
                response = _a.sent();
                if (!response.ok) {
                    throw new Error("HTTP error! status: ".concat(response.status));
                }
                return [4 /*yield*/, response.json()];
            case 4:
                data = _a.sent();
                allBugs = allBugs.concat(data.data);
                next = data.next;
                _a.label = 5;
            case 5:
                if (next) return [3 /*break*/, 2];
                _a.label = 6;
            case 6:
                console.log("Fetched ".concat(allBugs.length, " bug cards")); // Debugging log
                return [2 /*return*/, { success: true, value: allBugs }];
            case 7:
                error_1 = _a.sent();
                return [2 /*return*/, { success: false, error: error_1 }];
            case 8: return [2 /*return*/];
        }
    });
}); };
// Function to get all groups from Shortcut
var getAllGroupsFromShortcut = function () { return __awaiter(void 0, void 0, void 0, function () {
    var response, data, error_2;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                console.log("Fetching groups from URL: ".concat(SHORTCUT_GROUPS_API_URL)); // Debugging log
                return [4 /*yield*/, fetch(SHORTCUT_GROUPS_API_URL, {
                        headers: {
                            'Shortcut-Token': SHORTCUT_API_TOKEN || '',
                        },
                    })];
            case 1:
                response = _a.sent();
                if (!response.ok) {
                    throw new Error("HTTP error! status: ".concat(response.status));
                }
                return [4 /*yield*/, response.json()];
            case 2:
                data = _a.sent();
                if (!Array.isArray(data)) {
                    throw new Error('Invalid response format');
                }
                console.log("Fetched ".concat(data.length, " groups")); // Debugging log
                return [2 /*return*/, { success: true, value: data }];
            case 3:
                error_2 = _a.sent();
                console.error('Error fetching groups:', error_2); // Enhanced error logging
                return [2 /*return*/, { success: false, error: error_2 }];
            case 4: return [2 /*return*/];
        }
    });
}); };
// Function to get all custom fields from Shortcut
var getAllCustomFieldsFromShortcut = function () { return __awaiter(void 0, void 0, void 0, function () {
    var response, data, error_3;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 3, , 4]);
                console.log("Fetching custom fields from URL: ".concat(SHORTCUT_CUSTOM_FIELDS_API_URL)); // Debugging log
                return [4 /*yield*/, fetch(SHORTCUT_CUSTOM_FIELDS_API_URL, {
                        headers: {
                            'Shortcut-Token': SHORTCUT_API_TOKEN || '',
                        },
                    })];
            case 1:
                response = _a.sent();
                if (!response.ok) {
                    throw new Error("HTTP error! status: ".concat(response.status));
                }
                return [4 /*yield*/, response.json()];
            case 2:
                data = _a.sent();
                if (!Array.isArray(data)) {
                    throw new Error('Invalid response format');
                }
                console.log("Fetched ".concat(data.length, " custom fields")); // Debugging log
                return [2 /*return*/, { success: true, value: data }];
            case 3:
                error_3 = _a.sent();
                console.error('Error fetching custom fields:', error_3); // Enhanced error logging
                return [2 /*return*/, { success: false, error: error_3 }];
            case 4: return [2 /*return*/];
        }
    });
}); };
// Function to write data to Google Sheets
var writeToGoogleSheets = function (data) { return __awaiter(void 0, void 0, void 0, function () {
    var credentials, auth, sheets, error_4;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                credentials = JSON.parse(Buffer.from(GOOGLE_CREDENTIALS_BASE64 || '', 'base64').toString('utf8'));
                auth = new googleapis_1.google.auth.GoogleAuth({
                    credentials: credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                sheets = googleapis_1.google.sheets({ version: 'v4', auth: auth });
                return [4 /*yield*/, sheets.spreadsheets.values.update({
                        spreadsheetId: GOOGLE_SHEETS_ID,
                        range: GOOGLE_SHEETS_RANGE,
                        valueInputOption: 'RAW',
                        requestBody: {
                            values: data,
                        },
                    })];
            case 1:
                _a.sent();
                return [2 /*return*/, { success: true, value: undefined }];
            case 2:
                error_4 = _a.sent();
                return [2 /*return*/, { success: false, error: error_4 }];
            case 3: return [2 /*return*/];
        }
    });
}); };
// Function to refresh the Google Sheet
var refreshGoogleSheet = function (spreadsheetId) { return __awaiter(void 0, void 0, void 0, function () {
    var credentials, auth, sheets, error_5;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                _a.trys.push([0, 2, , 3]);
                credentials = JSON.parse(Buffer.from(GOOGLE_CREDENTIALS_BASE64 || '', 'base64').toString('utf8'));
                auth = new googleapis_1.google.auth.GoogleAuth({
                    credentials: credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                sheets = googleapis_1.google.sheets({ version: 'v4', auth: auth });
                return [4 /*yield*/, sheets.spreadsheets.values.clear({
                        spreadsheetId: spreadsheetId,
                        range: GOOGLE_SHEETS_RANGE,
                    })];
            case 1:
                _a.sent();
                console.log('Google Sheet refreshed successfully.');
                return [3 /*break*/, 3];
            case 2:
                error_5 = _a.sent();
                console.error('Error refreshing Google Sheet:', error_5);
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); };
// Function to format date to "YYYY-MM-DD"
var formatDate = function (dateString) {
    if (!dateString)
        return '';
    var date = new Date(dateString);
    var year = date.getFullYear();
    var month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
    var day = date.getDate().toString().padStart(2, '0');
    return "".concat(year, "-").concat(month, "-").concat(day);
};
// Function to format bug data
var formatBugData = function (bugs, groups, customFields) {
    var groupMap = new Map(groups.map(function (group) { return [group.id, group.name]; }));
    var customFieldMap = new Map(customFields.map(function (field) { return [field.id, field]; }));
    return bugs.map(function (bug) {
        var customFields = bug.custom_fields
            .filter(function (field) { return field.value === 'Missed Bug (Production)' || field.value === 'Found Bug (Development)'; })
            .map(function (field) { return field.value; })
            .join(', ');
        var customFieldsValue = customFields || 'Others';
        var teamName = bug.group_id ? groupMap.get(bug.group_id) : 'Unknown';
        // Find the "Bugs found" custom field value
        var bugsFoundField = bug.custom_fields.find(function (field) {
            var customField = customFieldMap.get(field.field_id);
            if (customField && customField.name === 'Bugs Found') {
                var value = customField.values.find(function (v) { return v.id === field.value_id; });
                return value ? value.value : 'N/A';
            }
            return false;
        });
        var bugsFoundValue = bugsFoundField ? bugsFoundField.value : 'N/A';
        // Find the "Root Cause (for bugs)" custom field value
        var rootCauseField = bug.custom_fields.find(function (field) {
            var customField = customFieldMap.get(field.field_id);
            if (customField && customField.name === 'Root Cause (for bugs)') {
                var value = customField.values.find(function (v) { return v.id === field.value_id; });
                return value ? value.value : 'N/A';
            }
            return false;
        });
        var rootCauseValue = rootCauseField ? rootCauseField.value : 'N/A';
        // Find the "Severity" custom field value
        var severityField = bug.custom_fields.find(function (field) {
            var customField = customFieldMap.get(field.field_id);
            if (customField && customField.name === 'Severity') {
                var value = customField.values.find(function (v) { return v.id === field.value_id; });
                return value ? value.value : 'N/A';
            }
            return false;
        });
        var severityValue = severityField ? severityField.value : 'N/A';
        return [
            bug.id,
            bug.name,
            bug.story_type,
            formatDate(bug.started_at),
            formatDate(bug.completed_at),
            formatDate(bug.created_at),
            formatDate(bug.updated_at),
            customFieldsValue,
            bug.labels.map(function (label) { return label.name; }).join(', '),
            bug.estimate,
            bug.stats.num_related_documents,
            bug.app_url,
            teamName,
            bugsFoundValue, // Add the "Bugs found" custom field value
            rootCauseValue, // Add the "Root Cause (for bugs)" custom field value
            severityValue // Add the "Severity" custom field value
        ];
    });
};
// Main function
var main = function () { return __awaiter(void 0, void 0, void 0, function () {
    var bugCardsResult, groupsResult, customFieldsResult, formattedData, writeResult;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                // Reload environment variables
                dotenv.config();
                return [4 /*yield*/, getAllBugCardsFromShortcut()];
            case 1:
                bugCardsResult = _a.sent();
                if (!bugCardsResult.success || !bugCardsResult.value) {
                    console.error('Error fetching bug cards:', bugCardsResult.error);
                    return [2 /*return*/];
                }
                return [4 /*yield*/, getAllGroupsFromShortcut()];
            case 2:
                groupsResult = _a.sent();
                if (!groupsResult.success || !groupsResult.value) {
                    console.error('Error fetching groups/teams:', groupsResult.error);
                    return [2 /*return*/];
                }
                return [4 /*yield*/, getAllCustomFieldsFromShortcut()];
            case 3:
                customFieldsResult = _a.sent();
                if (!customFieldsResult.success || !customFieldsResult.value) {
                    console.error('Error fetching custom fields:', customFieldsResult.error);
                    return [2 /*return*/];
                }
                formattedData = formatBugData(bugCardsResult.value, groupsResult.value, customFieldsResult.value);
                return [4 /*yield*/, writeToGoogleSheets(__spreadArray([[
                            'ID', 'Name', 'Story Type', 'Started At', 'Completed At', 'Created At', 'Updated At', 'Bug Type', 'Labels', 'Estimate', 'Num Related Documents', 'App URL', 'Team Name', 'Bugs Found', 'Root Cause', 'Severity'
                        ]], formattedData, true))];
            case 4:
                writeResult = _a.sent();
                if (!writeResult.success) {
                    console.error('Error writing to Google Sheets:', writeResult.error);
                    return [2 /*return*/];
                }
                if (!GOOGLE_SHEETS_ID) return [3 /*break*/, 6];
                return [4 /*yield*/, refreshGoogleSheet(GOOGLE_SHEETS_ID)];
            case 5:
                _a.sent();
                return [3 /*break*/, 7];
            case 6:
                console.error('Error: GOOGLE_SHEETS_ID is not defined.');
                _a.label = 7;
            case 7:
                console.log('🎉✨ Data successfully written to Google Sheets! 🚀📊');
                return [2 /*return*/];
        }
    });
}); };
main();
