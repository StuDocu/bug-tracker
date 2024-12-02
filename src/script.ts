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
  custom_fields: { name: string; value: string }[];
  labels: { name: string }[];
  estimate: number | null;
  stats: { num_related_documents: number };
  app_url: string;
  team_name?: string;
};

type ShortcutResponse = {
  data: Bug[];
  next: string | null;
};

// Shortcut API configuration
const SHORTCUT_API_TOKEN = process.env.SHORTCUT_API_TOKEN;
const SHORTCUT_API_URL = 'https://api.app.shortcut.com/api/v3/search/stories';

// Google Sheets API configuration
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_SHEETS_RANGE = 'Sheet1!A1';
const GOOGLE_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Function to get the date one year ago
const getDateOneYearAgo = (): string => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().split('T')[0];
};

// Function to get all bug-type cards from Shortcut with pagination
const getAllBugCardsFromShortcut = async (): Promise<Result<Bug[]>> => {
  const dateOneYearAgo = getDateOneYearAgo();
  const query = `updated_at:-${dateOneYearAgo}.. type:bug`;
  let allBugs: Bug[] = [];
  let next: string | null = null;

  try {
    do {
      const url = next ? `${SHORTCUT_API_URL}${next}` : `${SHORTCUT_API_URL}?query=${encodeURIComponent(query)}`;
      console.log(`Fetching URL: ${url}`); // Debugging log
      const response: Response = await fetch(url, {
        headers: {
          'Shortcut-Token': SHORTCUT_API_TOKEN || '',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ShortcutResponse = await response.json();
      allBugs = allBugs.concat(data.data);
      next = data.next ? data.next : null;
    } while (next);

    return { success: true, value: allBugs };
  } catch (error) {
    return { success: false, error };
  }
};

// Function to write data to Google Sheets
const writeToGoogleSheets = async (data: any[]): Promise<Result<void>> => {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: GOOGLE_CREDENTIALS,
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
const formatBugData = (bugs: Bug[]): any[] => {
  return bugs.map((bug: Bug) => {
    const customFields = bug.custom_fields
      .filter((field: any) => field.value === 'Missed Bug (Production)' || field.value === 'Found Bug (Development)')
      .map((field: any) => field.value)
      .join(', ');

    const customFieldsValue = customFields || 'Others';

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
      bug.team_name || 'Unknown' // Assuming team_name is part of the bug data
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

  const formattedData = formatBugData(bugCardsResult.value);

  const writeResult = await writeToGoogleSheets([[
    'ID', 'Name', 'Story Type', 'Started At', 'Completed At', 'Created At', 'Updated At', 'Custom Fields', 'Labels', 'Estimate', 'Num Related Documents', 'App URL', 'Team Name'
  ], ...formattedData]);

  if (!writeResult.success) {
    console.error('Error writing to Google Sheets:', writeResult.error);
    return;
  }

  console.log('🎉✨ Data successfully written to Google Sheets! 🚀📊');
};

main();