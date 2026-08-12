import { google } from 'googleapis';
import * as dotenv from 'dotenv';

dotenv.config();

type Result<T> = {
  success: boolean;
  value?: T;
  error?: any;
};

// Shortcut bug card (source: search API)
type ShortcutBug = {
  id: number;
  name: string;
  story_type: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  labels: { name: string }[];
  estimate: number | null;
  app_url: string;
  group_id?: string;
};

type Group = {
  id: string;
  name: string;
};

type ShortcutResponse = {
  data: ShortcutBug[];
  next: string | null;
};

// Linear bug issue (source: GraphQL issues query)
type LinearBug = {
  identifier: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  estimate: number | null;
  url: string;
  labels: { nodes: { name: string }[] };
  team: { name: string };
};

// One row of the output sheet, source-agnostic
type SheetRow = {
  id: string;
  name: string;
  type: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  labels: string;
  estimate: number | null;
  url: string;
  teamName: string;
};

type LinearGraphQLResponse<T> = {
  data?: T;
  errors?: { message: string }[];
};

// Shortcut API configuration
const SHORTCUT_API_TOKEN = process.env.SHORTCUT_API_TOKEN;
const SHORTCUT_API_URL = 'https://api.app.shortcut.com/api/v3/search/stories';
const SHORTCUT_GROUPS_API_URL = 'https://api.app.shortcut.com/api/v3/groups';

// Linear API configuration (same pattern as linear-to-shortcut-migration.ts)
const LINEAR_API_TOKEN = process.env.LINEAR_API_TOKEN;
const LINEAR_API_URL = 'https://api.linear.app/graphql';

// Google Sheets API configuration
const GOOGLE_SHEETS_ID = process.env.GOOGLE_SHEETS_ID;
const GOOGLE_SHEETS_RANGE = 'Sheet1!A1';
const GOOGLE_CREDENTIALS_BASE64 = process.env.GOOGLE_CREDENTIALS_BASE64;

// Fetch all open bugs from Linear: label "Bug", not completed/canceled (BND-41 mapping:
// this workspace has one cross-team "Bug" label rather than per-team ones, so no lookup table needed)
const getAllBugsFromLinear = async (): Promise<Result<LinearBug[]>> => {
  const query = `
    query($after: String) {
      issues(
        filter: { labels: { name: { eq: "Bug" } }, state: { type: { nin: ["completed", "canceled"] } } }
        first: 100
        after: $after
      ) {
        nodes {
          identifier
          title
          createdAt
          updatedAt
          startedAt
          completedAt
          estimate
          url
          labels { nodes { name } }
          team { name }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  try {
    let allBugs: LinearBug[] = [];
    let after: string | undefined;

    do {
      const response = await fetch(LINEAR_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': LINEAR_API_TOKEN || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables: { after } }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const body: LinearGraphQLResponse<{ issues: { nodes: LinearBug[]; pageInfo: { hasNextPage: boolean; endCursor: string } } }> = await response.json();

      if (body.errors) {
        throw new Error(`GraphQL errors: ${body.errors.map(e => e.message).join(', ')}`);
      }
      if (!body.data) {
        throw new Error('Linear GraphQL response missing data');
      }

      allBugs = allBugs.concat(body.data.issues.nodes);
      after = body.data.issues.pageInfo.hasNextPage ? body.data.issues.pageInfo.endCursor : undefined;
    } while (after);

    console.log(`Fetched ${allBugs.length} bug issues from Linear`);
    return { success: true, value: allBugs };
  } catch (error) {
    return { success: false, error };
  }
};

// Function to get all bug-type cards from Shortcut with pagination
const getAllBugCardsFromShortcut = async (): Promise<Result<ShortcutBug[]>> => {
  const query = `type:bug !is:archived !is:done`;
  let allBugs: ShortcutBug[] = [];
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

    console.log(`Fetched ${allBugs.length} bug cards from Shortcut`); // Debugging log

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

const linearBugToRow = (bug: LinearBug): SheetRow => ({
  id: bug.identifier,
  name: bug.title,
  type: 'bug',
  startedAt: bug.startedAt,
  completedAt: bug.completedAt,
  createdAt: bug.createdAt,
  updatedAt: bug.updatedAt,
  labels: bug.labels.nodes.map(l => l.name).join(', '),
  estimate: bug.estimate,
  url: bug.url,
  teamName: bug.team?.name || 'Unknown',
});

const shortcutBugToRow = (bug: ShortcutBug, groupMap: Map<string, string>): SheetRow => ({
  id: String(bug.id),
  name: bug.name,
  type: bug.story_type,
  startedAt: bug.started_at,
  completedAt: bug.completed_at,
  createdAt: bug.created_at,
  updatedAt: bug.updated_at,
  labels: bug.labels.map(l => l.name).join(', '),
  estimate: bug.estimate,
  url: bug.app_url,
  teamName: bug.group_id ? (groupMap.get(bug.group_id) || 'Unknown') : 'Unknown',
});

const formatRows = (rows: SheetRow[]): any[] =>
  rows.map(row => [
    row.id,
    row.name,
    row.type,
    formatDate(row.startedAt),
    formatDate(row.completedAt),
    formatDate(row.createdAt),
    formatDate(row.updatedAt),
    row.labels,
    row.estimate,
    row.url,
    row.teamName,
  ]);

// Main function
const main = async (): Promise<void> => {
  // Reload environment variables
  dotenv.config();

  // Linear-first (BND-68): Linear-tracked bugs are the source of truth going forward.
  // Shortcut is still queried in full as a fallback for teams/bugs not yet in Linear -
  // ponytail: no de-dup between the two beyond that, revisit once every team has cut over
  // and the Shortcut leg can be dropped.
  const linearBugsResult = await getAllBugsFromLinear();
  if (!linearBugsResult.success || !linearBugsResult.value) {
    console.error('Error fetching bugs from Linear:', linearBugsResult.error);
    return;
  }

  const bugCardsResult = await getAllBugCardsFromShortcut();
  if (!bugCardsResult.success || !bugCardsResult.value) {
    console.error('Error fetching bug cards from Shortcut:', bugCardsResult.error);
    return;
  }

  const groupsResult = await getAllGroupsFromShortcut();
  if (!groupsResult.success || !groupsResult.value) {
    console.error('Error fetching groups/teams:', groupsResult.error);
    return;
  }

  const groupMap = new Map(groupsResult.value.map(group => [group.id, group.name]));

  const rows: SheetRow[] = [
    ...linearBugsResult.value.map(linearBugToRow),
    ...bugCardsResult.value.map(bug => shortcutBugToRow(bug, groupMap)),
  ];

  const writeResult = await writeToGoogleSheets([[
    'ID', 'Name', 'Type', 'Started At', 'Completed At', 'Created At', 'Updated At', 'Labels', 'Estimate', 'URL', 'Team Name'
  ], ...formatRows(rows)]);

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

  console.log(`🎉✨ Data successfully written to Google Sheets! ${rows.length} bugs (${linearBugsResult.value.length} Linear, ${bugCardsResult.value.length} Shortcut) 🚀📊`);
};

main();
