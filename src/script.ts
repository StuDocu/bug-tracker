import { google } from 'googleapis';
import * as dotenv from 'dotenv';

dotenv.config();

type Result<T> = {
  success: boolean;
  value?: T;
  error?: any;
};

type Bug = {
  id: number;
  name: string;
  story_type: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  custom_fields: { field_id: string; value_id: string; value: string }[];
  labels: { name: string }[];
  estimate: number | null;
  stats: { num_related_documents: number };
  app_url: string;
  team_name?: string;
  group_id?: string;
};

type Group = {
  id: string;
  name: string;
};

type CustomField = {
  id: string;
  name: string;
  values: { id: string; value: string }[];
};

type ShortcutResponse = {
  data: Bug[];
  next: string | null;
};

// Shortcut API configuration
const SHORTCUT_API_TOKEN = process.env.SHORTCUT_API_TOKEN;
const SHORTCUT_API_URL = 'https://api.app.shortcut.com/api/v3/search/stories';
const SHORTCUT_GROUPS_API_URL = 'https://api.app.shortcut.com/api/v3/groups';
const SHORTCUT_CUSTOM_FIELDS_API_URL = 'https://api.app.shortcut.com/api/v3/custom-fields';

// Google Sheets API configuration
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_SHEETS_RANGE = 'Sheet1!A1';
const GOOGLE_CREDENTIALS_BASE64 = process.env.GOOGLE_CREDENTIALS_BASE64;

// Function to get the date six months ago
const getDateSixMonthsAgo = (): string => {
  const date = new Date();
  date.setMonth(date.getMonth() - 6);
  return date.toISOString().split('T')[0];
};

// Function to get all bug-type cards from Shortcut with pagination
const getAllBugCardsFromShortcut = async (): Promise<Result<Bug[]>> => {
  const query = `type:bug !is:archived !is:done`;
  let allBugs: Bug[] = [];
  let next: string | null = null;

  try {
    do {
      const url = next ? new URL(next, SHORTCUT_API_URL).href : `${SHORTCUT_API_URL}?query=${encodeURIComponent(query)}`;
      console.log(`Fetching URL: ${url}`); // Debugging log

      // Break the loop if the next parameter contains a specific pattern
      if (next && next.includes('page_size=1')) {
        console.log("Next parameter ", next)
        console.log('Breaking the loop to avoid 400 error');
        break;
      }

      const response = await fetch(url, {
        headers: {
          'Shortcut-Token': SHORTCUT_API_TOKEN || '',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ShortcutResponse = await response.json();
      allBugs = allBugs.concat(data.data);
      next = data.next;
    } while (next);

    console.log(`Fetched ${allBugs.length} bug cards`); // Debugging log

    return { success: true, value: allBugs };
  } catch (error) {
    return { success: false, error };
  }
};

// Function to get all groups from Shortcut
const getAllGroupsFromShortcut = async (): Promise<Result<Group[]>> => {
  try {
    console.log(`Fetching groups from URL: ${SHORTCUT_GROUPS_API_URL}`); // Debugging log
    const response = await fetch(SHORTCUT_GROUPS_API_URL, {
      headers: {
        'Shortcut-Token': SHORTCUT_API_TOKEN || '',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: Group[] = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Invalid response format');
    }

    console.log(`Fetched ${data.length} groups`); // Debugging log
    return { success: true, value: data };
  } catch (error) {
    console.error('Error fetching groups:', error); // Enhanced error logging
    return { success: false, error };
  }
};

// Function to get all custom fields from Shortcut
const getAllCustomFieldsFromShortcut = async (): Promise<Result<CustomField[]>> => {
  try {
    console.log(`Fetching custom fields from URL: ${SHORTCUT_CUSTOM_FIELDS_API_URL}`); // Debugging log
    const response = await fetch(SHORTCUT_CUSTOM_FIELDS_API_URL, {
      headers: {
        'Shortcut-Token': SHORTCUT_API_TOKEN || '',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: CustomField[] = await response.json();

    if (!Array.isArray(data)) {
      throw new Error('Invalid response format');
    }

    console.log(`Fetched ${data.length} custom fields`); // Debugging log
    return { success: true, value: data };
  } catch (error) {
    console.error('Error fetching custom fields:', error); // Enhanced error logging
    return { success: false, error };
  }
};

// Function to write data to Google Sheets
const writeToGoogleSheets = async (data: any[]): Promise<Result<void>> => {
  try {
    const credentials = JSON.parse(Buffer.from(GOOGLE_CREDENTIALS_BASE64 || '', 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.update({
      spreadsheetId: GOOGLE_SHEETS_ID,
      range: GOOGLE_SHEETS_RANGE,
      valueInputOption: 'RAW',
      requestBody: {
        values: data,
      },
    });

    return { success: true, value: undefined };
  } catch (error) {
    return { success: false, error };
  }
};

// Function to refresh the Google Sheet
const refreshGoogleSheet = async (spreadsheetId: string) => {
  try {
    const credentials = JSON.parse(Buffer.from(GOOGLE_CREDENTIALS_BASE64 || '', 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: GOOGLE_SHEETS_RANGE,
    });

    console.log('Google Sheet refreshed successfully.');
  } catch (error) {
    console.error('Error refreshing Google Sheet:', error);
  }
};

// Function to format date to "YYYY-MM-DD"
const formatDate = (dateString: string | null): string => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Months are zero-based
  const day = date.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Function to format bug data
const formatBugData = (bugs: Bug[], groups: Group[], customFields: CustomField[]): any[] => {
  const groupMap = new Map(groups.map(group => [group.id, group.name]));
  const customFieldMap = new Map(customFields.map(field => [field.id, field]));

  return bugs.map((bug: Bug) => {
    const customFields = bug.custom_fields
      .filter((field: any) => field.value === 'Missed Bug (Production)' || field.value === 'Found Bug (Development)')
      .map((field: any) => field.value)
      .join(', ');

    const customFieldsValue = customFields || 'Others';
    const teamName = bug.group_id ? groupMap.get(bug.group_id) : 'Unknown';

    // Find the "Bugs found" custom field value
    const bugsFoundField = bug.custom_fields.find(field => {
      const customField = customFieldMap.get(field.field_id);
      if (customField && customField.name === 'Bugs Found') {
        const value = customField.values.find(v => v.id === field.value_id);
        return value ? value.value : 'N/A';
      }
      return false;
    });
    const bugsFoundValue = bugsFoundField ? bugsFoundField.value : 'N/A';

    // Find the "Root Cause (for bugs)" custom field value
    const rootCauseField = bug.custom_fields.find(field => {
      const customField = customFieldMap.get(field.field_id);
      if (customField && customField.name === 'Root Cause (for bugs)') {
        const value = customField.values.find(v => v.id === field.value_id);
        return value ? value.value : 'N/A';
      }
      return false;
    });
    const rootCauseValue = rootCauseField ? rootCauseField.value : 'N/A';

    // Find the "Severity" custom field value
    const severityField = bug.custom_fields.find(field => {
      const customField = customFieldMap.get(field.field_id);
      if (customField && customField.name === 'Severity') {
        const value = customField.values.find(v => v.id === field.value_id);
        return value ? value.value : 'N/A';
      }
      return false;
    });
    const severityValue = severityField ? severityField.value : 'N/A';

    return [
      bug.id,
      bug.name,
      bug.story_type,
      formatDate(bug.started_at),
      formatDate(bug.completed_at),
      formatDate(bug.created_at),
      formatDate(bug.updated_at),
      customFieldsValue,
      bug.labels.map((label: any) => label.name).join(', '),
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
const main = async (): Promise<void> => {
  // Reload environment variables
  dotenv.config();

  const bugCardsResult = await getAllBugCardsFromShortcut();
  if (!bugCardsResult.success || !bugCardsResult.value) {
    console.error('Error fetching bug cards:', bugCardsResult.error);
    return;
  }

  const groupsResult = await getAllGroupsFromShortcut();
  if (!groupsResult.success || !groupsResult.value) {
    console.error('Error fetching groups/teams:', groupsResult.error);
    return;
  }

  const customFieldsResult = await getAllCustomFieldsFromShortcut();
  if (!customFieldsResult.success || !customFieldsResult.value) {
    console.error('Error fetching custom fields:', customFieldsResult.error);
    return;
  }

  const formattedData = formatBugData(bugCardsResult.value, groupsResult.value, customFieldsResult.value);

  const writeResult = await writeToGoogleSheets([[
    'ID', 'Name', 'Story Type', 'Started At', 'Completed At', 'Created At', 'Updated At', 'Bug Type', 'Labels', 'Estimate', 'Num Related Documents', 'App URL', 'Team Name', 'Bugs Found', 'Root Cause', 'Severity'
  ], ...formattedData]);

  if (!writeResult.success) {
    console.error('Error writing to Google Sheets:', writeResult.error);
    return;
  }

  // Refresh the Google Sheet
  if (GOOGLE_SHEETS_ID) {
    await refreshGoogleSheet(GOOGLE_SHEETS_ID);
  } else {
    console.error('Error: GOOGLE_SHEETS_ID is not defined.');
  }

  console.log('🎉✨ Data successfully written to Google Sheets! 🚀📊');
};

main();