import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load .env from project root (works when running from dist/ or from project root)
const projectRoot = fs.existsSync(path.join(process.cwd(), '.env'))
  ? process.cwd()
  : path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

/**
 * Linear to Shortcut Migration Script
 * 
 * IMPORTANT SAFETY NOTES:
 * - READ-ONLY from Linear: Only fetches/reads data, NEVER modifies or deletes anything in Linear
 * - WRITE-ONLY to Shortcut: Only creates new stories/epics/labels, NEVER deletes anything in Shortcut
 * - Duplicate Prevention: Checks for existing stories before creating to prevent duplicates
 * - Safe to run multiple times: Will skip stories that already exist
 */

// Reuse Result type from existing script
type Result<T> = {
  success: boolean;
  value?: T;
  error?: any;
};

// Linear API Types
type LinearTeam = {
  id: string;
  name: string;
  key: string;
  archivedAt?: string | null;
};

type LinearInitiative = {
  id: string;
  name: string;
  description?: string;
  status: string;
  targetDate?: string;
  createdAt: string;
  updatedAt: string;
  documents?: {
    nodes: Array<{
      title: string;
      url: string;
    }>;
  };
};

type LinearProject = {
  id: string;
  name: string;
  description?: string;
  state: string; // Legacy field - Linear may use status instead
  status?: {
    id: string;
    name: string;
    type: string; // "backlog", "planned", "started", "paused", "completed", "canceled"
  };
  startDate?: string;
  targetDate?: string;
  progress?: number;
  completedAt?: string;
  canceledAt?: string;
  createdAt: string;
  updatedAt: string;
  priority?: number;
  lead?: {
    id: string;
    name: string;
    email: string;
  };
  members?: {
    nodes: Array<{
      id: string;
      name: string;
      email: string;
    }>;
  };
  teams?: {
    nodes: Array<{
      id: string;
      name: string;
      key: string;
    }>;
  };
  labels?: {
    nodes: Array<{
      id: string;
      name: string;
    }>;
  };
  initiatives?: {
    nodes: Array<{
      id: string;
      name: string;
    }>;
  };
  documents?: {
    nodes: Array<{
      title: string;
      url: string;
    }>;
  };
};

type LinearIssue = {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: {
    id: string;
    name: string;
    type: string;
  };
  priority: number;
  assignee?: {
    id: string;
    name: string;
    email: string;
  };
  project?: {
    id: string;
    name: string;
  };
  labels: {
    nodes: Array<{
      id: string;
      name: string;
    }>;
  };
  estimate?: number;
  dueDate?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  cycle?: {
    id: string;
    name: string;
    number: number;
  };
  parent?: {
    id: string;
  };
  children?: {
    nodes: Array<{
      id: string;
      title: string;
    }>;
  };
};

type LinearGraphQLResponse<T> = {
  data: T;
  errors?: Array<{ message: string }>;
};

// Shortcut API Types
type ShortcutTeam = {
  id: string;
  name: string;
  mention_name: string;
};

type ShortcutWorkflow = {
  id: number;
  name: string;
  states: Array<{
    id: number;
    name: string;
    type: string;
  }>;
};

type ShortcutEpic = {
  id: number;
  name: string;
  description?: string;
  epic_state_id?: number; // Numeric ID of the epic's state
  state?: string; // Human-readable state name
  archived?: boolean;
  started?: boolean;
  completed?: boolean;
  completed_at?: string;
  deadline?: string;
  created_at?: string;
  updated_at?: string;
};

type ShortcutObjective = {
  id: number;
  name: string;
  description?: string;
  state?: string;
  target_date?: string;
  created_at?: string;
  updated_at?: string;
};

type ShortcutLabel = {
  id: number;
  name: string;
};

type ShortcutUser = {
  id: string;
  profile: {
    name: string;
    email_address: string | null;
    mention_name: string;
    deactivated: boolean;
  };
};

type ShortcutStory = {
  id: number;
  name: string;
  app_url?: string;
  url?: string;
};

// API Configuration
const LINEAR_API_TOKEN = process.env.LINEAR_API_TOKEN;
const LINEAR_API_URL = 'https://api.linear.app/graphql';

const SHORTCUT_API_TOKEN = process.env.SHORTCUT_API_TOKEN;
const SHORTCUT_API_URL = 'https://api.app.shortcut.com/api/v3';

// Test mode: Set TEST_MODE=true in .env to migrate limited number of issues for testing
const TEST_MODE = process.env.TEST_MODE === 'true' || process.env.TEST_MODE === '1';
// Test limit: Number of issues to migrate in test mode (default: 1)
const TEST_LIMIT = process.env.TEST_LIMIT ? parseInt(process.env.TEST_LIMIT, 10) : 1;
// Skip epic/objective creation: Set to true to only update stories, not create epics/objectives
const SKIP_EPIC_OBJECTIVE_CREATION = process.env.SKIP_EPIC_OBJECTIVE_CREATION === 'true' || process.env.SKIP_EPIC_OBJECTIVE_CREATION === '1';
// Update existing epics: Set to true to update existing epics (default: false, only create new ones)
const UPDATE_EXISTING_EPICS = process.env.UPDATE_EXISTING_EPICS === 'true' || process.env.UPDATE_EXISTING_EPICS === '1';

// Team mapping configuration
// Teams to skip during migration
const TEAMS_TO_SKIP = [
  'Product Ideas', 
  'Mobile',
  'Mobile App',
];

// Only Foundation and Education are considered; ignore "Studocu AI" (standalone) in descriptions/labels
// Use this to filter team names so epics/objectives/tickets don't show multiple teams including Studocu AI
const RELEVANT_TEAM_NAMES = ['Foundation', 'Education'];
const IGNORED_TEAM_NAME = 'Studocu AI';

/** Returns team names that are Foundation or Education, excluding standalone "Studocu AI". */
const filterRelevantTeamNames = (teams: Array<{ name: string }>): string[] => {
  if (!teams || teams.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of teams) {
    const n = t.name.trim();
    if (!n) continue;
    const lower = n.toLowerCase();
    if (lower === IGNORED_TEAM_NAME.toLowerCase()) continue;
    const isRelevant = RELEVANT_TEAM_NAMES.some(r => lower.includes(r.toLowerCase()));
    if (isRelevant && !seen.has(n)) {
      seen.add(n);
      result.push(n);
    }
  }
  return result;
};

// Team name mapping: Linear team name → Shortcut team name/identifier
// The script will automatically discover teams and use this mapping
// Note: Shortcut team names use dashes: "Studocu AI - Education" and "Studocu AI - Foundation"
const TEAM_NAME_MAPPING: Record<string, string> = {
  'Studocu Education': 'Studocu AI - Education',
  'Education': 'Studocu AI - Education',
  'Studocu Foundation': 'Studocu AI - Foundation',
  'Foundation': 'Studocu AI - Foundation',
  'Inputs': 'Studocu AI - Foundation', // Inputs team maps to Foundation
};

// Optional: Manual team mapping via environment variables (only used as fallback if automatic discovery fails)
// These are NOT required - the script will automatically discover and map teams by name
// The filter below ensures only mappings with both IDs set are included
const TEAM_MAPPING: Array<{ linearTeamId: string; shortcutTeamId: string }> = [
  { linearTeamId: process.env.LINEAR_TEAM_1_ID || '', shortcutTeamId: process.env.SHORTCUT_TEAM_1_ID || '' },
  { linearTeamId: process.env.LINEAR_TEAM_2_ID || '', shortcutTeamId: process.env.SHORTCUT_TEAM_2_ID || '' },
].filter(m => m.linearTeamId && m.shortcutTeamId); // Only include mappings that have both IDs set

// Status mapping - maps Linear status names to Shortcut workflow state names
// This is a fallback mapping; the script will also try fuzzy matching
// Customize this based on your Linear status names
//
// Available Shortcut workflow states (based on your workflow):
// Backlog: Parking lot
// Unstarted: Inbox (Default), Need Input, Assigned Bugs, Blocked, Prioritized Bugs, 
//            Spec, Refinement, Ready to be Prioritized, Next Sprint, Ready
// Started: Implementation in Progress, Review In Progress, Ready for Design Acceptance,
//          Design Acceptance in Progress, Ready for User Acceptance, 
//          User Acceptance In Progress, Ready to be Merged, Ready to be Released
// Done: Released, Done
// Tickets/Stories Status Mapping (Linear → Shortcut)
// Map Linear issue statuses to Shortcut workflow states (with exact emoji matching)
const STATUS_MAPPING: Record<string, string> = {
  'Backlog': 'Parking lot 🚗',
  'Refinement': 'Refinement 🔄',
  'Ready to be Prioritized': 'Ready to be Prioritized 🔢',
  'Ready 🏁': 'Ready 🏁',
  'In Progress 💪': 'Implementation In Progress 💪',
  'In Review 🕵': 'Review In Progress 🕵️‍♀️',
  'User Acceptance 🧑‍💻': 'User Acceptance In Progress 🧑‍💻',
  'Done ✅': 'Done ✅',
  'Canceled': 'Parking lot 🚗',
  'Duplicate': 'Done ✅',
  'Triage': 'Inbox 📥',
};

// Design workflow status mapping (for tickets with "Design" label)
const DESIGN_STATUS_MAPPING: Record<string, string> = {
  'Backlog': 'Parking lot 🚗',
  'Refinement': 'Ready for refinement ‼️',
  'Ready 🏁': 'Next up ⏭️',
  'In Progress 💪': 'In Progress 💪 Ongoing',
  'In Review 🕵': 'Ready for review - Feedback 👏',
  'Done ✅': 'Done ✅',
  'Canceled': 'Parking lot 🚗',
  'Duplicate': 'Done ✅',
  'Triage': 'Parking lot 🚗',
};

// Projects/Epics Status Mapping (Linear → Shortcut)
// Map Linear project statuses to Shortcut epic states
// Valid Shortcut epic states: "to do", "in progress", "done"
// Note: "Discarded" is achieved by setting archived: true, not a state
const EPIC_STATUS_MAPPING: Record<string, string> = {
  'Backlog': 'to do',
  'Later': 'to do',
  'Next': 'to do',
  'Now': 'in progress',
  'Completed': 'done',
  'Canceled': 'done',  // Canceled projects should be marked as done, not discarded
};

// Initiatives/Objectives Status Mapping (Linear → Shortcut)
// Map Linear initiative statuses to Shortcut objective states
const OBJECTIVE_STATUS_MAPPING: Record<string, string> = {
  'Planned': 'To Do',
  'Active': 'In Progress',
  'Completed': 'Done',
};

// Helper function to make Linear GraphQL requests
const linearGraphQLRequest = async <T>(query: string, variables?: any): Promise<Result<T>> => {
  try {
    const response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': LINEAR_API_TOKEN || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const data: LinearGraphQLResponse<T> = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL errors: ${data.errors.map(e => e.message).join(', ')}`);
    }

    return { success: true, value: data.data };
  } catch (error) {
    return { success: false, error };
  }
};

// Helper function to make Shortcut API requests
const shortcutApiRequest = async <T>(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: any
): Promise<Result<T>> => {
  try {
    const response = await fetch(`${SHORTCUT_API_URL}${endpoint}`, {
      method,
      headers: {
        'Shortcut-Token': SHORTCUT_API_TOKEN || '',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    const data: T = await response.json();
    return { success: true, value: data };
  } catch (error) {
    return { success: false, error };
  }
};

/**
 * Normalize a date from Linear for Shortcut (YYYY-MM-DD).
 * - "Q1 2025", "Q4 2025" etc. → last day of that quarter (e.g. 2025-12-31 for Q4 2025)
 * - Already ISO date (YYYY-MM-DD) → returned as-is
 * - Invalid or empty → undefined
 */
const normalizeDateForShortcut = (value: string | undefined | null): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;

  // Quarter format: Q1 2025, Q2 2025, Q3 2025, Q4 2025 (allow variants like "Q4 2025", "Q4-2025")
  const quarterMatch = s.match(/Q\s*([1-4])\s*[\s\-/]*\s*(\d{4})/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1], 10);
    const year = parseInt(quarterMatch[2], 10);
    const lastDayByQuarter: Record<number, string> = {
      1: `${year}-03-31`,
      2: `${year}-06-30`,
      3: `${year}-09-30`,
      4: `${year}-12-31`,
    };
    return lastDayByQuarter[quarter];
  }

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // ISO date-time (take date part only)
  const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // Try parsing as date (e.g. MM/DD/YYYY, DD-MM-YYYY)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return undefined;
};

// Fetch Linear teams (including subteams)
// READ-ONLY: Only fetches data from Linear, no modifications
const getLinearTeams = async (): Promise<Result<LinearTeam[]>> => {
  const query = `
    query {
      teams {
        nodes {
          id
          name
          key
          archivedAt
        }
      }
    }
  `;

  const result = await linearGraphQLRequest<{ teams: { nodes: LinearTeam[] } }>(query);
  if (!result.success || !result.value) {
    return { success: false, error: result.error };
  }

  // Filter out archived teams and return all teams (including subteams)
  const activeTeams = result.value.teams.nodes.filter(team => !team.archivedAt);
  
  return { success: true, value: activeTeams };
};

// Fetch Linear initiatives
// READ-ONLY: Only fetches data from Linear, no modifications
const getLinearInitiatives = async (): Promise<Result<LinearInitiative[]>> => {
  const query = `
    query {
      initiatives {
        nodes {
          id
          name
          description
          status
          targetDate
          createdAt
          updatedAt
          documents(first: 20) {
            nodes {
              title
              url
            }
          }
        }
      }
    }
  `;

  const result = await linearGraphQLRequest<{ initiatives: { nodes: LinearInitiative[] } }>(query);
  if (!result.success || !result.value) {
    console.error(`  ❌ Error fetching Linear initiatives:`, result.error);
    return { success: false, error: result.error };
  }

  return { success: true, value: result.value.initiatives.nodes };
};

// Fetch Linear projects for a team
// READ-ONLY: Only fetches data from Linear, no modifications
// Note: Simplified query to avoid complexity limits - fetch essential fields first
const getLinearProjects = async (teamId: string): Promise<Result<LinearProject[]>> => {
  const query = `
    query($teamId: String!) {
      team(id: $teamId) {
        projects {
          nodes {
            id
            name
            description
            state
            status {
              id
              name
              type
            }
            startDate
            targetDate
            progress
            completedAt
            canceledAt
            createdAt
            updatedAt
            priority
            lead {
              id
              name
              email
            }
            members(first: 20) {
              nodes {
                id
                name
                email
              }
            }
            teams(first: 10) {
              nodes {
                id
                name
                key
              }
            }
            labels(first: 20) {
              nodes {
                id
                name
              }
            }
            initiatives(first: 10) {
              nodes {
                id
                name
              }
            }
            documents(first: 20) {
              nodes {
                title
                url
              }
            }
          }
        }
      }
    }
  `;

  const result = await linearGraphQLRequest<{ team: { projects: { nodes: LinearProject[] } } }>(
    query,
    { teamId }
  );

  if (!result.success || !result.value) {
    console.error(`  ❌ Error fetching Linear projects for team ${teamId}:`, result.error);
    return { success: false, error: result.error };
  }

  return { success: true, value: result.value.team.projects.nodes };
};

// Fetch Linear issues for a team with pagination
// READ-ONLY: Only fetches data from Linear, no modifications
const getLinearIssues = async (teamId: string): Promise<Result<LinearIssue[]>> => {
  const query = `
    query($teamId: String!, $after: String) {
      team(id: $teamId) {
        issues(first: 100, after: $after) {
          nodes {
            id
            identifier
            title
            description
            state {
              id
              name
              type
            }
            priority
            assignee {
              id
              name
              email
            }
            project {
              id
              name
            }
            labels {
              nodes {
                id
                name
              }
            }
            estimate
            dueDate
            createdAt
            updatedAt
            startedAt
            completedAt
            cycle {
              id
              name
              number
            }
            parent {
              id
            }
            children {
              nodes {
                id
                title
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  `;

  let allIssues: LinearIssue[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;

  try {
    while (hasNextPage) {
      const result: Result<{
        team: {
          issues: {
            nodes: LinearIssue[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      }> = await linearGraphQLRequest<{
        team: {
          issues: {
            nodes: LinearIssue[];
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
          };
        };
      }>(query, { teamId, after: cursor });

      if (!result.success || !result.value) {
        console.error(`❌ Error in Linear GraphQL query:`, result.error);
        return { success: false, error: result.error };
      }

      const issues = result.value.team.issues;
      allIssues = allIssues.concat(issues.nodes);
      hasNextPage = issues.pageInfo.hasNextPage;
      cursor = issues.pageInfo.endCursor;
    }

    console.log(`Fetched ${allIssues.length} issues from Linear team ${teamId}`);
    return { success: true, value: allIssues };
  } catch (error) {
    return { success: false, error };
  }
};

// Get Shortcut teams (called "Groups" in Shortcut API)
const getShortcutTeams = async (): Promise<Result<ShortcutTeam[]>> => {
  // Use /groups endpoint - in Shortcut API, teams are called "Groups"
  const result = await shortcutApiRequest<unknown>('/groups');
  
  if (!result.success) {
    return { success: false, error: result.error };
  }

  // API may return array directly or wrapped as { data: [...] }
  const raw = result.value;
  let teams: ShortcutTeam[] | null = null;
  if (Array.isArray(raw)) {
    teams = raw as ShortcutTeam[];
  } else if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    teams = (raw as { data: ShortcutTeam[] }).data;
  }
  if (!teams) {
    return { success: false, error: new Error('Shortcut API returned unexpected shape (expected array or { data: array })') };
  }

  console.log(`\n📋 Shortcut API returned ${teams.length} teams (groups)`);
  console.log('   Team names:', teams.map(t => t.name).join(', '));

  return { success: true, value: teams };
};

// Find Shortcut team by name (supports partial matching and subteam matching)
const findShortcutTeamByName = (
  teamName: string,
  shortcutTeams: ShortcutTeam[]
): ShortcutTeam | null => {
  const teamNameLower = teamName.toLowerCase().trim();
  
  // Strategy 1: Try exact match first
  let team = shortcutTeams.find(t => t.name === teamName);
  if (team) return team;

  // Strategy 2: Try case-insensitive exact match
  team = shortcutTeams.find(t => t.name.toLowerCase() === teamNameLower);
  if (team) return team;

  // Strategy 3: Try matching last part of Shortcut team name (for subteams)
  // e.g., "Education" should match "Studocu AI - Education" or "Studocu AI > Education"
  team = shortcutTeams.find(t => {
    const shortcutNameLower = t.name.toLowerCase();
    // Check if Shortcut team name contains a separator (">" or "-")
    const separators = ['>', '-'];
    for (const separator of separators) {
      if (shortcutNameLower.includes(separator)) {
        const lastPart = shortcutNameLower.split(separator).pop()?.trim();
        if (lastPart === teamNameLower) {
          return true;
        }
      }
    }
    // Also check if the full Shortcut name contains the Linear team name
    if (shortcutNameLower.includes(teamNameLower) || teamNameLower.includes(shortcutNameLower)) {
      return true;
    }
    return false;
  });
  if (team) return team;

  // Strategy 4: Try matching by key words (e.g., "Education" in "Studocu AI - Education")
  // Extract the last meaningful word from Linear team name
  const linearWords = teamNameLower.split(/\s+/).filter(w => w.length > 2);
  if (linearWords.length > 0) {
    const lastWord = linearWords[linearWords.length - 1];
    team = shortcutTeams.find(t => {
      const shortcutNameLower = t.name.toLowerCase();
      // Check if Shortcut name contains the last word after a separator (">" or "-")
      const separators = ['>', '-'];
      for (const separator of separators) {
        if (shortcutNameLower.includes(separator)) {
          const afterSeparator = shortcutNameLower.split(separator).pop()?.trim() || '';
          if (afterSeparator.includes(lastWord) || lastWord.includes(afterSeparator)) {
            return true;
          }
        }
      }
      return shortcutNameLower.includes(lastWord);
    });
    if (team) return team;
  }

  return null;
};

// Automatically discover and map Linear teams to Shortcut teams
const discoverTeamMappings = async (): Promise<Result<Array<{ linearTeamId: string; shortcutTeamId: string; linearTeamName: string; shortcutTeamName: string }>>> => {
  console.log('🔍 Discovering teams...\n');

  // Get Linear teams
  const linearTeamsResult = await getLinearTeams();
  if (!linearTeamsResult.success || !linearTeamsResult.value) {
    const err = linearTeamsResult.error;
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to fetch Linear teams: ${msg}` };
  }

  // Get Shortcut teams
  const shortcutTeamsResult = await getShortcutTeams();
  if (!shortcutTeamsResult.success || !shortcutTeamsResult.value) {
    const err = shortcutTeamsResult.error;
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to fetch Shortcut teams: ${msg}` };
  }

  const linearTeams = linearTeamsResult.value;
  const shortcutTeams = shortcutTeamsResult.value;

  console.log(`Found ${linearTeams.length} Linear teams (including subteams):`);
  linearTeams.forEach(team => {
    console.log(`  - ${team.name} (${team.key}) [ID: ${team.id}]`);
  });

  console.log(`\nFound ${shortcutTeams.length} Shortcut teams:`);
  shortcutTeams.forEach(team => {
    console.log(`  - ${team.name} [ID: ${team.id}]`);
  });

  const mappings: Array<{ linearTeamId: string; shortcutTeamId: string; linearTeamName: string; shortcutTeamName: string }> = [];

  // Map each Linear team
  for (const linearTeam of linearTeams) {
    // Skip teams that should not be migrated
    if (TEAMS_TO_SKIP.some(skipName => linearTeam.name.toLowerCase().includes(skipName.toLowerCase()))) {
      console.log(`\n⏭️  Skipping team: ${linearTeam.name} (in skip list)`);
      continue;
    }

    // Find matching Shortcut team
    let shortcutTeam: ShortcutTeam | null = null;

    // Try explicit mapping first
    const mappedName = TEAM_NAME_MAPPING[linearTeam.name];
    if (mappedName) {
      shortcutTeam = findShortcutTeamByName(mappedName, shortcutTeams);
      if (shortcutTeam) {
        console.log(`\n✅ Mapped: "${linearTeam.name}" → "${shortcutTeam.name}" (via explicit mapping: ${linearTeam.name} → ${mappedName})`);
      } else {
        console.log(`\n⚠️  Explicit mapping found for "${linearTeam.name}" → "${mappedName}", but Shortcut team not found`);
      }
    }

    // Try direct name match if explicit mapping didn't work
    if (!shortcutTeam) {
      shortcutTeam = findShortcutTeamByName(linearTeam.name, shortcutTeams);
      if (shortcutTeam) {
        console.log(`\n✅ Mapped: "${linearTeam.name}" → "${shortcutTeam.name}" (via automatic name matching)`);
      }
    }

    if (shortcutTeam) {
      mappings.push({
        linearTeamId: linearTeam.id,
        shortcutTeamId: shortcutTeam.id,
        linearTeamName: linearTeam.name,
        shortcutTeamName: shortcutTeam.name,
      });
    } else {
      console.warn(`\n⚠️  Could not find Shortcut team for Linear team: "${linearTeam.name}"`);
      console.warn(`   Available Shortcut teams: ${shortcutTeams.map(t => t.name).join(', ')}`);
    }
  }

  return { success: true, value: mappings };
};

// Get Shortcut workflows for a team
// Note: Shortcut workflows might be workspace-wide or team-specific
const getShortcutWorkflows = async (teamId: string): Promise<Result<ShortcutWorkflow[]>> => {
  // Try getting workflows for the specific team/group
  let result = await shortcutApiRequest<ShortcutWorkflow[]>(`/groups/${teamId}/workflows`);
  
  // If that fails, try getting all workflows (workspace-wide)
  if (!result.success) {
    result = await shortcutApiRequest<ShortcutWorkflow[]>(`/workflows`);
    
    // If we get all workflows, filter by team if needed
    if (result.success && result.value) {
      // Workflows might have a team_id or group_id field to filter
      // For now, return all workflows - we'll use the first one that matches
      return result;
    }
  }
  
  // If still no success, try the teams endpoint as fallback
  if (!result.success) {
    result = await shortcutApiRequest<ShortcutWorkflow[]>(`/teams/${teamId}/workflows`);
  }
  
  return result;
};


// Get Shortcut epics for a team
const getShortcutEpics = async (teamId: string): Promise<Result<ShortcutEpic[]>> => {
  // Try getting epics for the specific team/group
  let result = await shortcutApiRequest<ShortcutEpic[]>(`/groups/${teamId}/epics`);
  
  // If that fails, try getting all epics (workspace-wide)
  if (!result.success) {
    result = await shortcutApiRequest<ShortcutEpic[]>('/epics');
  }
  
  return result;
};

// Get Shortcut objectives
const getShortcutObjectives = async (): Promise<Result<ShortcutObjective[]>> => {
  return shortcutApiRequest<ShortcutObjective[]>('/objectives');
};

// Create or update Shortcut objective from Linear initiative
// WRITE-ONLY to Shortcut: Creates new objectives or updates existing ones, never deletes
const createOrUpdateShortcutObjective = async (
  initiative: LinearInitiative,
  shortcutUsers: ShortcutUser[],
  existingObjectiveId?: number,
  updatedObjectivesCollector?: UpdatedObjectiveRecord[]
): Promise<Result<number>> => {
  // Build comprehensive description with all initiative information
  const descriptionParts: string[] = [];
  
  // Add main description FIRST (this is the primary content)
  if (initiative.description && initiative.description.trim()) {
    descriptionParts.push(initiative.description.trim());
  }
  
  // Normalize target date for description (Q4 2025 → last day of quarter). Shortcut API does not accept target_date on objectives (disallowed-key).
  const objectiveTargetDate = normalizeDateForShortcut(initiative.targetDate);

  // Add metadata section (only if we have metadata to add)
  const hasMetadata = initiative.targetDate || (initiative.documents && initiative.documents.nodes.length > 0);
  
  if (hasMetadata || !initiative.description) {
    descriptionParts.push('');
    descriptionParts.push('---');
    descriptionParts.push('Migrated from Linear Initiative');
    descriptionParts.push(`Linear Initiative Status: ${initiative.status}`);
    
    if (objectiveTargetDate) {
      descriptionParts.push(`Target Date: ${objectiveTargetDate}`);
    } else if (initiative.targetDate) {
      descriptionParts.push(`Target Date: ${initiative.targetDate}`);
    }
  }
  
  // Add resources/documents information
  if (initiative.documents && initiative.documents.nodes.length > 0) {
    descriptionParts.push('');
    descriptionParts.push('Resources:');
    initiative.documents.nodes.forEach(doc => {
      descriptionParts.push(`- [${doc.title}](${doc.url})`);
    });
  }
  
  const description = descriptionParts.join('\n');

  // Map initiative status to objective state using OBJECTIVE_STATUS_MAPPING
  let objectiveState = 'to do'; // Default
  
  if (initiative.status) {
    const mappedState = OBJECTIVE_STATUS_MAPPING[initiative.status];
    if (mappedState) {
      objectiveState = mappedState.toLowerCase(); // Shortcut API expects lowercase
    } else {
      // Fallback to fuzzy matching if no explicit mapping
      const statusLower = initiative.status.toLowerCase();
      if (statusLower.includes('active') || statusLower.includes('started') || statusLower.includes('in progress')) {
        objectiveState = 'in progress';
      } else if (statusLower.includes('completed') || statusLower.includes('done')) {
        objectiveState = 'done';
      }
    }
  }

  // Note: Linear initiatives don't have lead/teams in the API, so we skip owner_ids
  const ownerIds: string[] = [];

  const objectiveData: any = {
    name: initiative.name,
    description,
    state: objectiveState,
    owner_ids: ownerIds.length > 0 ? ownerIds : undefined,
  };

  // Remove undefined fields
  Object.keys(objectiveData).forEach(key => {
    if (objectiveData[key] === undefined) {
      delete objectiveData[key];
    }
  });

  if (existingObjectiveId) {
    // Check if we should update existing objectives or just return the existing ID
    if (!UPDATE_EXISTING_EPICS) {
      console.log(`  ⏭️  Skipping update for existing objective "${initiative.name}" (ID: ${existingObjectiveId})`);
      return { success: true, value: existingObjectiveId };
    }
    
    // Update existing objective
    const result = await shortcutApiRequest<ShortcutObjective>(`/objectives/${existingObjectiveId}`, 'PUT', objectiveData);
    if (!result.success || !result.value) {
      console.error(`  ❌ Failed to update objective "${initiative.name}" (ID: ${existingObjectiveId}):`, result.error);
      return { success: false, error: result.error };
    }
    if (updatedObjectivesCollector) {
      updatedObjectivesCollector.push({
        name: initiative.name,
        id: existingObjectiveId,
        targetDate: objectiveTargetDate || undefined,
      });
    }
    return { success: true, value: existingObjectiveId };
  } else {
    // Create new objective
    const result = await shortcutApiRequest<ShortcutObjective>('/objectives', 'POST', objectiveData);
    if (!result.success || !result.value) {
      console.error(`  ❌ Failed to create objective "${initiative.name}":`, result.error);
      return { success: false, error: result.error };
    }
    return { success: true, value: result.value.id };
  }
};

// Get Shortcut labels
const getShortcutLabels = async (): Promise<Result<ShortcutLabel[]>> => {
  return shortcutApiRequest<ShortcutLabel[]>('/labels');
};

// Get Shortcut users
const getShortcutUsers = async (): Promise<Result<ShortcutUser[]>> => {
  const result = await shortcutApiRequest<ShortcutUser[]>('/members');
  
  // Debug: Log the response structure
  if (result.success && result.value) {
    console.log(`\n📊 Fetched ${result.value.length} Shortcut members`);
    if (result.value.length > 0) {
      console.log(`   Sample member structure:`, JSON.stringify(result.value[0], null, 2));
    }
  }
  
  return result;
};

// Get Shortcut iterations for a team
const getShortcutIterations = async (teamId: string): Promise<Result<Array<{ id: number; name: string; number: number }>>> => {
  // Try getting iterations for the specific team/group
  let result = await shortcutApiRequest<Array<{ id: number; name: string; number: number }>>(`/groups/${teamId}/iterations`);
  
  // If that fails, try getting all iterations (workspace-wide)
  if (!result.success) {
    result = await shortcutApiRequest<Array<{ id: number; name: string; number: number }>>('/iterations');
  }
  
  return result;
};

// Map Linear priority to Shortcut priority label
// Linear: 0 = No priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
// We'll add priority as a label since Shortcut doesn't have a built-in priority field
const mapPriorityToShortcut = (linearPriority: number): string | null => {
  if (linearPriority === 0) return null; // No priority
  if (linearPriority === 1) return 'Priority: Urgent';
  if (linearPriority === 2) return 'Priority: High';
  if (linearPriority === 3) return 'Priority: Medium';
  if (linearPriority === 4) return 'Priority: Low';
  return null;
};

// Get story details including URL and epic
const getStoryDetails = async (storyId: number): Promise<Result<{ id: number; name: string; app_url?: string; url?: string; epic_id?: number }>> => {
  return shortcutApiRequest<{ id: number; name: string; app_url?: string; url?: string; epic_id?: number }>(`/stories/${storyId}`);
};

// Search for existing story in Shortcut by Linear identifier
// READ-ONLY: Only searches/reads from Shortcut, no modifications
// If teamIds is an array (e.g. Foundation + Education), searches all so we don't create duplicates across teams
const findExistingStoryByLinearId = async (
  linearIdentifier: string,
  teamIds: string | string[]
): Promise<Result<number | null>> => {
  const ids = Array.isArray(teamIds) ? teamIds : [teamIds];
  try {
    for (const teamId of ids) {
      const searchQueries = [
        `team:${teamId} "Migrated Ticket ${linearIdentifier}"`,
        `team:${teamId} "${linearIdentifier}"`,
      ];

      for (const searchQuery of searchQueries) {
        const encodedQuery = encodeURIComponent(searchQuery);
        const result = await shortcutApiRequest<{ data: Array<{ id: number; name: string; description?: string }> }>(
          `/search/stories?query=${encodedQuery}`
        );

        if (result.success && result.value && result.value.data && result.value.data.length > 0) {
          for (const story of result.value.data) {
            const storyDetails = await shortcutApiRequest<{
              id: number;
              external_links?: Array<{ id: number; url: string }>;
              description?: string;
            }>(`/stories/${story.id}`);

            if (storyDetails.success && storyDetails.value) {
              const storyData = storyDetails.value;
              if (storyData.description && storyData.description.includes(`Migrated Ticket ${linearIdentifier}`)) {
                return { success: true, value: storyData.id };
              }
              if (storyData.description && storyData.description.includes(`Migrated from Linear: ${linearIdentifier}`)) {
                return { success: true, value: storyData.id };
              }
              if (storyData.external_links && storyData.external_links.some(link => link.url.includes(linearIdentifier))) {
                return { success: true, value: storyData.id };
              }
            }
          }
        }
      }
    }
    return { success: true, value: null };
  } catch (error) {
    return { success: true, value: null };
  }
};

// Create or find Shortcut label
const findOrCreateShortcutLabel = async (labelName: string): Promise<Result<number>> => {
  // First, try to find existing label
  const labelsResult = await getShortcutLabels();
  if (labelsResult.success && labelsResult.value) {
    const existingLabel = labelsResult.value.find(l => l.name.toLowerCase() === labelName.toLowerCase());
    if (existingLabel) {
      return { success: true, value: existingLabel.id };
    }
  }

  // Create new label if not found
  const createResult = await shortcutApiRequest<ShortcutLabel>('/labels', 'POST', {
    name: labelName,
  });

  if (!createResult.success || !createResult.value) {
    return { success: false, error: 'Failed to create label' };
  }

  return { success: true, value: createResult.value.id };
};

// Map Linear project status to Shortcut epic state ID
// Uses EPIC_STATUS_MAPPING for explicit mappings and epic workflow states
// Returns the epic_state_id that matches the desired state
const mapProjectStateToEpicStateId = (
  project: LinearProject,
  epicWorkflowStates: Array<{ id: number; name: string; type: string }>
): number | null => {
  if (epicWorkflowStates.length === 0) {
    console.warn(`  ⚠️  No epic workflow states available`);
    return null;
  }

  const projectStatus = project.status;
  
  if (!projectStatus) {
    console.warn(`  ⚠️  Project "${project.name}" has no status. Using first available epic state.`);
    return epicWorkflowStates[0]?.id || null;
  }
  
  // Strategy 1: Map by status type first (most reliable for "completed" → "done")
  // Linear project status types: 'backlog', 'unstarted', 'started', 'paused', 'completed', 'canceled'
  // Shortcut epic state types: 'unstarted', 'started', 'done'
  
  if (projectStatus.type === 'completed') {
    // For completed projects, MUST use a "done" type state
    const doneState = epicWorkflowStates.find(s => s.type === 'done');
    if (doneState) {
      console.log(`  📌 Mapping project "${project.name}" (status: ${projectStatus.name}, type: ${projectStatus.type}) → Epic state: "${doneState.name}" (ID: ${doneState.id}, type: done)`);
      return doneState.id;
    }
  } else if (projectStatus.type === 'canceled') {
    // For canceled projects, also use "done" type state (not discarded)
    const doneState = epicWorkflowStates.find(s => s.type === 'done');
    if (doneState) {
      console.log(`  📌 Mapping project "${project.name}" (status: ${projectStatus.name}, type: ${projectStatus.type}) → Epic state: "${doneState.name}" (ID: ${doneState.id}, type: done) [canceled→done]`);
      return doneState.id;
    }
  } else if (projectStatus.type === 'started' || projectStatus.type === 'paused') {
    const startedState = epicWorkflowStates.find(s => s.type === 'started');
    if (startedState) {
      console.log(`  📌 Mapping project "${project.name}" (status: ${projectStatus.name}, type: ${projectStatus.type}) → Epic state: "${startedState.name}" (ID: ${startedState.id}, type: started)`);
      return startedState.id;
    }
  } else if (projectStatus.type === 'backlog' || projectStatus.type === 'unstarted') {
    const unstartedState = epicWorkflowStates.find(s => s.type === 'unstarted');
    if (unstartedState) {
      console.log(`  📌 Mapping project "${project.name}" (status: ${projectStatus.name}, type: ${projectStatus.type}) → Epic state: "${unstartedState.name}" (ID: ${unstartedState.id}, type: unstarted)`);
      return unstartedState.id;
    }
  }
  
  // Final fallback: use first available state
  console.warn(`  ⚠️  Could not map project status "${projectStatus.name}" (type: ${projectStatus.type}) for project "${project.name}". Using first available epic state.`);
  return epicWorkflowStates[0]?.id || null;
};

// Create or update Shortcut epic from Linear project
// WRITE-ONLY to Shortcut: Creates new epics or updates existing ones, never deletes
const createOrUpdateShortcutEpic = async (
  project: LinearProject,
  teamId: string,
  shortcutUsers: ShortcutUser[],
  epicWorkflowStates: Array<{ id: number; name: string; type: string }>,
  existingEpicId?: number,
  objectiveId?: number,
  updatedEpicsCollector?: UpdatedEpicRecord[]
): Promise<Result<number>> => {
  // Build comprehensive description with all project information
  const descriptionParts: string[] = [];
  
  // Add main description FIRST (this is the primary content)
  if (project.description && project.description.trim()) {
    descriptionParts.push(project.description.trim());
  }
  
  // Add metadata section (only if we have metadata to add)
  const hasMetadata = project.startDate || project.targetDate || project.progress !== undefined || 
                      project.lead || (project.members && project.members.nodes.length > 0) ||
                      (project.teams && project.teams.nodes.length > 0) ||
                      (project.initiatives && project.initiatives.nodes.length > 0) ||
                      (project.documents && project.documents.nodes.length > 0);
  
  if (hasMetadata || !project.description) {
    // Only add separator if we already have description content
    if (project.description && project.description.trim()) {
      descriptionParts.push('');
      descriptionParts.push('---');
    }
    descriptionParts.push('Migrated from Linear Project');
    // Use status if available, otherwise fall back to state
    const stateInfo = project.status 
      ? `${project.status.name} (type: ${project.status.type})`
      : project.state;
    descriptionParts.push(`Linear Project State: ${stateInfo}`);
  }
  
  if (project.startDate) {
    descriptionParts.push(`Start Date: ${project.startDate}`);
  }
  if (project.targetDate) {
    descriptionParts.push(`Target Date: ${project.targetDate}`);
  }
  if (project.progress !== undefined) {
    descriptionParts.push(`Progress: ${(project.progress * 100).toFixed(2)}%`);
  }
  
  // Add lead information
  if (project.lead) {
    descriptionParts.push(`Lead: ${project.lead.name} (${project.lead.email})`);
  }
  
  // Add members information
  if (project.members && project.members.nodes.length > 0) {
    const memberNames = project.members.nodes.map(m => `${m.name} (${m.email})`).join(', ');
    descriptionParts.push(`Members: ${memberNames}`);
  }
  
  // Add teams information (only Foundation and Education; ignore Studocu AI)
  if (project.teams && project.teams.nodes.length > 0) {
    const relevantTeams = filterRelevantTeamNames(project.teams.nodes);
    if (relevantTeams.length > 0) {
      descriptionParts.push(`Teams: ${relevantTeams.join(', ')}`);
    }
  }
  
  // Add initiative information
  if (project.initiatives && project.initiatives.nodes.length > 0) {
    descriptionParts.push('');
    descriptionParts.push('Initiatives:');
    project.initiatives.nodes.forEach(initiative => {
      descriptionParts.push(`- ${initiative.name}`);
    });
  }
  
  // Add resources/documents information
  if (project.documents && project.documents.nodes.length > 0) {
    descriptionParts.push('');
    descriptionParts.push('Resources:');
    project.documents.nodes.forEach(doc => {
      descriptionParts.push(`- [${doc.title}](${doc.url})`);
    });
  }
  
  const description = descriptionParts.join('\n');

  // Map Linear project state/status to Shortcut epic state ID
  // Pass the entire project object to access both state and status fields
  const epicStateId = mapProjectStateToEpicStateId(project, epicWorkflowStates);
  if (!epicStateId) {
    const stateInfo = project.status 
      ? `${project.status.name} (type: ${project.status.type})`
      : project.state;
    console.warn(`  ⚠️  Could not map Linear state "${stateInfo}" to Shortcut epic state ID`);
    // Don't proceed if we can't map the state
    return { success: false, error: `Could not map Linear state "${stateInfo}" to Shortcut epic state ID` };
  }

  // Map lead and members to owner_ids
  const ownerIds: string[] = [];
  if (project.lead) {
    const leadUserId = mapUserToShortcut(project.lead.email, shortcutUsers);
    if (leadUserId) {
      ownerIds.push(leadUserId);
    }
  }
  if (project.members && project.members.nodes) {
    for (const member of project.members.nodes) {
      const memberUserId = mapUserToShortcut(member.email, shortcutUsers);
      if (memberUserId && !ownerIds.includes(memberUserId)) {
        ownerIds.push(memberUserId);
      }
    }
  }

  // Map labels (project labels + priority + teams)
  const labelIds: number[] = [];
  
  // Add project labels
  if (project.labels && project.labels.nodes) {
    for (const label of project.labels.nodes) {
      const labelResult = await findOrCreateShortcutLabel(label.name);
      if (labelResult.success && labelResult.value) {
        labelIds.push(labelResult.value);
      }
    }
  }
  
  // Add priority as label
  if (project.priority !== undefined) {
    const priorityLabel = mapPriorityToShortcut(project.priority);
    if (priorityLabel) {
      const priorityLabelResult = await findOrCreateShortcutLabel(priorityLabel);
      if (priorityLabelResult.success && priorityLabelResult.value) {
        labelIds.push(priorityLabelResult.value);
      }
    }
  }
  
  // Add teams as labels (only Foundation and Education; ignore Studocu AI)
  if (project.teams && project.teams.nodes) {
    const relevantTeams = filterRelevantTeamNames(project.teams.nodes);
    for (const teamName of relevantTeams) {
      const teamLabelResult = await findOrCreateShortcutLabel(`Team: ${teamName}`);
      if (teamLabelResult.success && teamLabelResult.value) {
        labelIds.push(teamLabelResult.value);
      }
    }
  }

  // Normalize dates: Q4 2025 → last day of quarter; ISO dates passed through
  const epicStartDate = normalizeDateForShortcut(project.startDate);
  const epicDeadline = normalizeDateForShortcut(project.targetDate);

  // Base epic data - fields that work for both create and update
  const baseEpicData: any = {
    name: project.name,
    description,
    epic_state_id: epicStateId, // Use epic_state_id (numeric ID)
    group_id: teamId, // Use group_id instead of team_id
    planned_start_date: epicStartDate || undefined,
    deadline: epicDeadline || undefined,
    owner_ids: ownerIds.length > 0 ? ownerIds : undefined,
    objective_ids: objectiveId ? [objectiveId] : undefined, // Use objective_ids array
  };
  
  // Don't include label_ids - it's causing API errors with epics
  // TODO: Re-enable once API issues are resolved

  // Remove undefined fields
  Object.keys(baseEpicData).forEach(key => {
    if (baseEpicData[key] === undefined) {
      delete baseEpicData[key];
    }
  });

  if (existingEpicId) {
    // Check if we should update existing epics or just return the existing ID
    if (!UPDATE_EXISTING_EPICS) {
      console.log(`  ⏭️  Skipping update for existing epic "${project.name}" (ID: ${existingEpicId})`);
      return { success: true, value: existingEpicId };
    }
    
    // Update existing epic - include allowed fields
    // Use epic_state_id (numeric ID) to set the state
    // Set archived to false to prevent "discarded" state
    const updateData: any = {
      name: baseEpicData.name,
      description: baseEpicData.description,
      epic_state_id: baseEpicData.epic_state_id, // Use epic_state_id
      planned_start_date: baseEpicData.planned_start_date,
      deadline: baseEpicData.deadline,
      owner_ids: baseEpicData.owner_ids,
      objective_ids: baseEpicData.objective_ids, // Use objective_ids array
    };
    
    // Don't include archived - it's causing API errors
    
    // Remove undefined fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === undefined) {
        delete updateData[key];
      }
    });

    const result = await shortcutApiRequest<ShortcutEpic>(`/epics/${existingEpicId}`, 'PUT', updateData);
    if (!result.success || !result.value) {
      console.error(`  ❌ Failed to update epic "${project.name}" (ID: ${existingEpicId}):`, result.error);
      return { success: false, error: result.error };
    }
    if (updatedEpicsCollector) {
      updatedEpicsCollector.push({
        name: project.name,
        id: existingEpicId,
        startDate: epicStartDate || undefined,
        deadline: epicDeadline || undefined,
      });
    }
    return { success: true, value: existingEpicId };
  } else {
    // Create new epic - can include more fields including objective_ids
    const createData: any = {
      name: baseEpicData.name,
      description: baseEpicData.description,
      epic_state_id: baseEpicData.epic_state_id, // Use epic_state_id
      group_id: baseEpicData.group_id,
      planned_start_date: baseEpicData.planned_start_date,
      deadline: baseEpicData.deadline,
      owner_ids: baseEpicData.owner_ids,
      objective_ids: baseEpicData.objective_ids, // Use objective_ids array
    };
    
    // Don't include label_ids or archived - they're causing API errors
    
    // Remove undefined fields
    Object.keys(createData).forEach(key => {
      if (createData[key] === undefined) {
        delete createData[key];
      }
    });

    const result = await shortcutApiRequest<ShortcutEpic>('/epics', 'POST', createData);
    if (!result.success || !result.value) {
      console.error(`  ❌ Failed to create epic "${project.name}":`, result.error);
      return { success: false, error: result.error };
    }
    
    return { success: true, value: result.value.id };
  }
};

// Helper function to remove emojis from text for comparison
// Handles various emoji ranges including modern emojis, symbols, and pictographs
const removeEmojis = (text: string): string => {
  return text
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Miscellaneous Symbols and Pictographs
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Miscellaneous Symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map Symbols
    .trim();
};

// Map Linear status to Shortcut workflow state ID
// Uses explicit mapping, fuzzy matching, and intelligent fallbacks
// Handles emojis in both Linear and Shortcut state names
// When isDesignTicket is true, uses ONLY states from the Design workflow so the story is placed in Design, not Development
const mapStatusToWorkflowState = (
  linearStatus: string,
  workflows: ShortcutWorkflow[],
  isDesignTicket: boolean = false
): number | null => {
  if (workflows.length === 0) {
    return null;
  }

  // For Design tickets: use only states from the Design workflow so we get a state ID that belongs to Design.
  // Otherwise Shortcut would assign the story to whichever workflow owns the state (e.g. Development).
  let allStates: Array<{ id: number; name: string; type: string }> = [];
  if (isDesignTicket) {
    const designWorkflow = workflows.find(w => w.name.toLowerCase().includes('design'));
    if (designWorkflow && designWorkflow.states.length > 0) {
      allStates = [...designWorkflow.states];
    } else if (isDesignTicket) {
      console.warn(`  ⚠️  Design ticket detected but no "Design" workflow found in Shortcut (workflows: ${workflows.map(w => w.name).join(', ')}). Using default workflow states.`);
    }
  }
  if (allStates.length === 0) {
    // Not a design ticket, or no Design workflow found: use all workflows
    workflows.forEach(workflow => {
      allStates.push(...workflow.states);
    });
  }

  // Normalize Linear status (remove emojis for comparison)
  const linearStatusClean = removeEmojis(linearStatus).toLowerCase();

  // Strategy 1: Try explicit mapping (use Design mapping if it's a Design ticket)
  const statusMap = isDesignTicket ? DESIGN_STATUS_MAPPING : STATUS_MAPPING;
  const mappedStatus = statusMap[linearStatus];
  if (mappedStatus) {
    // First try exact match (with emojis)
    let state = allStates.find(s => s.name === mappedStatus);
    
    // If not found, try matching without emojis
    if (!state) {
      const mappedStatusClean = removeEmojis(mappedStatus).toLowerCase();
      const matchingStates = allStates.filter(s => {
        const stateNameClean = removeEmojis(s.name).toLowerCase();
        return stateNameClean === mappedStatusClean;
      });
      // If multiple matches, prefer states that match the expected type
      // For "Released" type mappings, prefer "done" type states
      if (matchingStates.length > 0) {
        if (mappedStatusClean.includes('released') || mappedStatusClean.includes('done') || mappedStatusClean.includes('complete')) {
          state = matchingStates.find(s => s.type === 'done') || matchingStates[0];
        } else if (mappedStatusClean.includes('progress') || mappedStatusClean.includes('started')) {
          state = matchingStates.find(s => s.type === 'started') || matchingStates[0];
        } else {
          state = matchingStates[0];
        }
      }
    }
    if (state) {
      return state.id;
    }
  }

  // Strategy 2: Try exact case-insensitive match (with and without emojis)
  // First try exact match with emojis
  let exactMatch = allStates.find(s => s.name.toLowerCase() === linearStatus.toLowerCase());
  
  // If not found, try matching without emojis
  if (!exactMatch) {
    exactMatch = allStates.find(s => {
      const stateNameClean = removeEmojis(s.name).toLowerCase();
      return stateNameClean === linearStatusClean;
    });
  }
  
  if (exactMatch) {
    return exactMatch.id;
  }

  // Strategy 3: Try fuzzy/partial matching (with and without emojis)
  const linearStatusLower = linearStatus.toLowerCase();
  const fuzzyMatch = allStates.find(s => {
    const stateNameLower = s.name.toLowerCase();
    const stateNameClean = removeEmojis(s.name).toLowerCase();
    
    // Try matching with emojis first
    const matchWithEmojis = (
      stateNameLower.includes(linearStatusLower) ||
      linearStatusLower.includes(stateNameLower)
    );
    
    // Try matching without emojis
    const matchWithoutEmojis = (
      stateNameClean.includes(linearStatusClean) ||
      linearStatusClean.includes(stateNameClean) ||
      // Common variations
      (linearStatusClean.includes('progress') && stateNameClean.includes('progress')) ||
      (linearStatusClean.includes('review') && stateNameClean.includes('review')) ||
      (linearStatusClean.includes('ready') && stateNameClean.includes('ready')) ||
      (linearStatusClean.includes('released') && stateNameClean.includes('released')) ||
      (linearStatusClean.includes('done') && stateNameClean.includes('done')) ||
      (linearStatusClean.includes('complete') && stateNameClean.includes('done'))
    );
    
    return matchWithEmojis || matchWithoutEmojis;
  });
  if (fuzzyMatch) {
    return fuzzyMatch.id;
  }

  // Strategy 4: Map by state type (unstarted, started, done)
  // Try to infer from Linear status name
  const statusLower = linearStatus.toLowerCase();
  let preferredType: string | null = null;

  if (
    statusLower.includes('done') ||
    statusLower.includes('complete') ||
    statusLower.includes('closed') ||
    statusLower.includes('cancel')
  ) {
    preferredType = 'done';
  } else if (
    statusLower.includes('progress') ||
    statusLower.includes('started') ||
    statusLower.includes('review') ||
    statusLower.includes('implementation') ||
    statusLower.includes('acceptance')
  ) {
    preferredType = 'started';
  } else if (
    statusLower.includes('backlog') ||
    statusLower.includes('todo') ||
    statusLower.includes('inbox') ||
    statusLower.includes('ready') ||
    statusLower.includes('spec') ||
    statusLower.includes('refinement')
  ) {
    preferredType = 'unstarted';
  }

  if (preferredType) {
    const typeMatch = allStates.find(s => s.type === preferredType);
    if (typeMatch) {
      return typeMatch.id;
    }
  }

  // Strategy 5: Fallback to default state (usually Inbox) or first unstarted state
  const defaultState = allStates.find(s => s.name === 'Inbox') ||
    allStates.find(s => s.type === 'unstarted') ||
    allStates[0];

  if (defaultState) {
    console.warn(
      `⚠️  Could not map Linear status "${linearStatus}" to Shortcut state. Using fallback: "${defaultState.name}"`
    );
    return defaultState.id;
  }

  return null;
};

// Map Linear user to Shortcut user ID
// Track if we've logged debug info
let hasLoggedUserDebug = false;

const mapUserToShortcut = (
  linearEmail: string,
  shortcutUsers: ShortcutUser[]
): string | null => {
  // Debug: Log the first few users to see the structure
  if (shortcutUsers.length > 0 && !hasLoggedUserDebug) {
    console.log(`\n🔍 DEBUG: Sample Shortcut users (first 3 active):`);
    shortcutUsers.filter(u => !u.profile.deactivated).slice(0, 3).forEach(u => {
      console.log(`   - ID: ${u.id}, Name: ${u.profile.name}, Email: ${u.profile.email_address || 'NO EMAIL'}`);
    });
    hasLoggedUserDebug = true;
  }
  
  // Find user by email (email is in profile.email_address)
  const user = shortcutUsers.find(u => 
    u.profile.email_address && 
    u.profile.email_address.toLowerCase() === linearEmail.toLowerCase() &&
    !u.profile.deactivated // Only match active users
  );
  
  if (!user) {
    // Debug: Show what we're looking for
    console.log(`\n🔍 DEBUG: Looking for email "${linearEmail}"`);
    const similarUsers = shortcutUsers.filter(u => 
      u.profile.email_address && 
      !u.profile.deactivated &&
      u.profile.email_address.toLowerCase().includes(linearEmail.split('@')[0].toLowerCase())
    );
    if (similarUsers.length > 0) {
      console.log(`   Found ${similarUsers.length} similar active user(s):`);
      similarUsers.forEach(u => console.log(`     - ${u.profile.name}: ${u.profile.email_address}`));
    } else {
      console.log(`   No similar users found.`);
    }
  }
  
  return user ? user.id : null;
};

// Create Shortcut story from Linear issue
// WRITE-ONLY to Shortcut: Creates new stories, never deletes or modifies existing ones
// READ-ONLY from Linear: Only reads issue data, never modifies Linear
const createShortcutStory = async (
  issue: LinearIssue,
  teamId: string,
  teamName: string, // Add team name for migration note
  workflows: ShortcutWorkflow[],
  shortcutUsers: ShortcutUser[],
  epicId?: number,
  iterationId?: number,
  teamIdsToCheckForDuplicate?: string[] // If set (e.g. [Foundation, Education]), avoid creating same story in multiple teams
): Promise<Result<number>> => {
  // Check if story already exists in this team or any of the other migrated teams (prevent duplicates)
  const idsToCheck = teamIdsToCheckForDuplicate && teamIdsToCheckForDuplicate.length > 0 ? teamIdsToCheckForDuplicate : [teamId];
  const existingStoryResult = await findExistingStoryByLinearId(issue.identifier, idsToCheck);
  if (existingStoryResult.success && existingStoryResult.value) {
    // Story already exists, return existing ID
    return { success: true, value: existingStoryResult.value, error: 'duplicate' };
  }

  // Check if this is a Design ticket
  const hasDesignLabel = issue.labels.nodes.some(label => 
    label.name.toLowerCase() === 'design' || 
    label.name.toLowerCase().includes('design')
  );
  
  if (hasDesignLabel) {
    console.log(`  🎨 Detected Design ticket for issue ${issue.identifier} (will use Design workflow)`);
  }

  const workflowStateId = mapStatusToWorkflowState(issue.state.name, workflows, hasDesignLabel);
  if (!workflowStateId) {
    return { success: false, error: `Could not map status: ${issue.state.name}` };
  }

  // Map labels
  const labelIds: number[] = [];
  for (const label of issue.labels.nodes) {
    const labelResult = await findOrCreateShortcutLabel(label.name);
    if (labelResult.success && labelResult.value) {
      labelIds.push(labelResult.value);
    }
  }
  
  // Add priority as a label if it exists
  const priorityLabel = mapPriorityToShortcut(issue.priority);
  if (priorityLabel) {
    const priorityLabelResult = await findOrCreateShortcutLabel(priorityLabel);
    if (priorityLabelResult.success && priorityLabelResult.value) {
      labelIds.push(priorityLabelResult.value);
    }
  }

  // Map assignee by email
  const ownerIds: string[] = [];
  if (issue.assignee && issue.assignee.email) {
    const userId = mapUserToShortcut(issue.assignee.email, shortcutUsers);
    if (userId) {
      ownerIds.push(userId);
      console.log(`  👤 Mapped assignee "${issue.assignee.email}" to Shortcut user ID: ${userId}`);
    } else {
      console.warn(`  ⚠️  Could not find Shortcut user for Linear assignee email: ${issue.assignee.email}`);
    }
  }

  // Determine story type based on Linear labels
  // Check if issue has a "Bug" label → map to Shortcut "bug" type
  // Otherwise default to "feature"
  // Shortcut story_type values: "feature", "bug", "chore"
  let storyType: 'feature' | 'bug' | 'chore' = 'feature'; // Default
  
  // Check labels to identify bugs
  const hasBugLabel = issue.labels.nodes.some(label => 
    label.name.toLowerCase() === 'bug' || 
    label.name.toLowerCase().includes('bug')
  );
  
  if (hasBugLabel) {
    storyType = 'bug';
    console.log(`  🐛 Detected bug type for issue ${issue.identifier} (has Bug label)`);
  }

  // Build description with migration metadata
  // Put Linear description first, then add migration metadata
  const descriptionParts: string[] = [];
  
  // Add main description FIRST (this is the primary content from Linear)
  if (issue.description && issue.description.trim()) {
    descriptionParts.push(issue.description.trim());
  }
  
  // Add metadata section
  descriptionParts.push('');
  descriptionParts.push('---');
  descriptionParts.push(`Migrated Ticket ${issue.identifier}`);
  descriptionParts.push(`Team: ${teamName}`);
  
  // Add assignee information if available
  if (issue.assignee) {
    descriptionParts.push(`Assigned to: ${issue.assignee.name} (${issue.assignee.email})`);
  }
  
  // Add additional metadata if available
  if (issue.startedAt) {
    descriptionParts.push(`Started: ${issue.startedAt}`);
  }
  if (issue.completedAt) {
    descriptionParts.push(`Completed: ${issue.completedAt}`);
  }
  
  const description = descriptionParts.join('\n');

  const storyData: any = {
    name: issue.title,
    description,
    workflow_state_id: workflowStateId,
    story_type: storyType,
    group_id: teamId, // Shortcut uses "group_id" not "team_id" (teams are called groups in API)
    estimate: issue.estimate || undefined, // Story points
    deadline: issue.dueDate || undefined,
    owner_ids: ownerIds.length > 0 ? ownerIds : undefined, // Assignee
    epic_id: epicId,
    iteration_id: iterationId, // Cycle/Iteration
  };
  
  // Labels disabled for now due to API issues
  // TODO: Re-enable labels once API issues are resolved
  // if (labelIds.length > 0) {
  //   storyData.label_ids = labelIds;
  // }

  // Remove undefined fields
  Object.keys(storyData).forEach(key => {
    if (storyData[key] === undefined) {
      delete storyData[key];
    }
  });

  const result = await shortcutApiRequest<ShortcutStory>('/stories', 'POST', storyData);

  if (!result.success || !result.value) {
    return { success: false, error: result.error };
  }

  const storyId = result.value.id;
  const storyUrl = result.value.app_url || result.value.url || `https://app.shortcut.com/story/${storyId}`;

  // Log the created story for verification
  console.log(`  ✅ Created story: ${result.value.name}`);
  console.log(`     Story ID: ${storyId}`);
  console.log(`     Shortcut URL: ${storyUrl}`);
  console.log(`     Linear Issue: ${issue.identifier}`);
  if (epicId) {
    console.log(`     Epic ID: ${epicId} (attached)`);
  } else {
    console.log(`     Epic: None (issue has no project in Linear)`);
  }

  // Add external link to Linear issue to help with duplicate detection
  // This makes it easier to find the story later
  try {
    // Try to construct Linear URL (format may vary, but this is a common pattern)
    const linearUrl = `https://linear.app/issue/${issue.identifier}`;
    await shortcutApiRequest<any>(`/stories/${storyId}/external-links`, 'POST', {
      external_id: issue.id,
      url: linearUrl,
    });
  } catch (error) {
    // External link creation is optional, don't fail if it doesn't work
    console.warn(`  ⚠️  Could not add external link for ${issue.identifier}: ${error}`);
  }

  return { success: true, value: storyId };
};

// Update existing story with assignee
const updateStoryAssignee = async (
  storyId: number,
  issue: LinearIssue,
  shortcutUsers: ShortcutUser[]
): Promise<Result<void>> => {
  // Map assignee by email
  const ownerIds: string[] = [];
  if (issue.assignee && issue.assignee.email) {
    const userId = mapUserToShortcut(issue.assignee.email, shortcutUsers);
    if (userId) {
      ownerIds.push(userId);
      console.log(`  👤 Updating story ${storyId} - assigning to "${issue.assignee.name}" (${issue.assignee.email})`);
    } else {
      console.warn(`  ⚠️  Could not find Shortcut user for Linear assignee email: ${issue.assignee.email}`);
      return { success: true, value: undefined }; // Not an error, just no user found
    }
  }

  if (ownerIds.length === 0) {
    console.log(`  ℹ️  Story ${storyId} - no assignee in Linear`);
    return { success: true, value: undefined };
  }

  // Update the story with owner_ids
  const updateData: any = {
    owner_ids: ownerIds
  };

  const result = await shortcutApiRequest<ShortcutStory>(`/stories/${storyId}`, 'PUT', updateData);

  if (!result.success || !result.value) {
    return { success: false, error: `Failed to update story ${storyId}: ${result.error}` };
  }

  console.log(`  ✅ Story ${storyId} successfully assigned to ${issue.assignee!.name}`);
  return { success: true, value: undefined };
};

// Update story type for existing stories
const updateStoryType = async (
  storyId: number,
  issue: LinearIssue,
  currentStoryType?: 'feature' | 'bug' | 'chore'
): Promise<Result<void>> => {
  // Determine correct story type from Linear issue labels
  let expectedStoryType: 'feature' | 'bug' | 'chore' = 'feature';
  
  // Check labels to identify bugs
  const hasBugLabel = issue.labels.nodes.some(label => 
    label.name.toLowerCase() === 'bug' || 
    label.name.toLowerCase().includes('bug')
  );
  
  if (hasBugLabel) {
    expectedStoryType = 'bug';
  }

  // Only update if types don't match
  if (currentStoryType && currentStoryType === expectedStoryType) {
    return { success: true, value: undefined }; // Already correct
  }

  const linearTypeInfo = hasBugLabel ? 'Bug (from label)' : 'Feature (default)';
  console.log(`  🔄 Updating story ${storyId} type: ${currentStoryType || 'unknown'} → ${expectedStoryType} (${linearTypeInfo})`);

  const updateData: any = {
    story_type: expectedStoryType
  };

  const result = await shortcutApiRequest<ShortcutStory>(`/stories/${storyId}`, 'PUT', updateData);

  if (!result.success || !result.value) {
    return { success: false, error: `Failed to update story type for ${storyId}: ${result.error}` };
  }

  console.log(`  ✅ Story ${storyId} type updated to ${expectedStoryType}`);
  return { success: true, value: undefined };
};

// Result type for workflow state update: { updated: true } when we actually moved the story
type WorkflowUpdateResult = Result<{ updated: boolean }>;

// Update workflow state for existing stories (especially Design tickets)
const updateStoryWorkflowState = async (
  storyId: number,
  issue: LinearIssue,
  workflows: ShortcutWorkflow[],
  currentWorkflowStateId?: number
): Promise<WorkflowUpdateResult> => {
  // Check if this is a Design ticket
  const hasDesignLabel = issue.labels.nodes.some(label => 
    label.name.toLowerCase() === 'design' || 
    label.name.toLowerCase().includes('design')
  );
  
  // Log labels for debugging
  if (hasDesignLabel) {
    const allLabels = issue.labels.nodes.map(l => l.name).join(', ');
    console.log(`     🎨 Design ticket detected (Issue: ${issue.identifier}, Labels: ${allLabels})`);
  }
  
  // Determine correct workflow state
  const expectedWorkflowStateId = mapStatusToWorkflowState(issue.state.name, workflows, hasDesignLabel);
  
  if (!expectedWorkflowStateId) {
    return { success: true, value: { updated: false } }; // No mapping found, skip
  }
  
  // Only update if states don't match
  if (currentWorkflowStateId && currentWorkflowStateId === expectedWorkflowStateId) {
    return { success: true, value: { updated: false } }; // Already correct
  }

  // Get state name for logging
  const allStates: Array<{ id: number; name: string; type: string }> = [];
  workflows.forEach(workflow => {
    allStates.push(...workflow.states);
  });
  const newStateName = allStates.find(s => s.id === expectedWorkflowStateId)?.name || 'unknown';
  const currentStateName = currentWorkflowStateId ? (allStates.find(s => s.id === currentWorkflowStateId)?.name || 'unknown') : 'unknown';
  
  const workflowType = hasDesignLabel ? 'Design' : 'Standard';
  console.log(`  🔄 Updating story ${storyId} workflow state (${workflowType}): ${currentStateName} → ${newStateName}`);

  const updateData: any = {
    workflow_state_id: expectedWorkflowStateId
  };

  const result = await shortcutApiRequest<ShortcutStory>(`/stories/${storyId}`, 'PUT', updateData);

  if (!result.success || !result.value) {
    return { success: false, error: `Failed to update workflow state for ${storyId}: ${result.error}` };
  }

  console.log(`  ✅ Story ${storyId} workflow state updated to ${newStateName}`);
  return { success: true, value: { updated: true } };
};

// Design tickets touched this run (moved to Design workflow or created in Design) for end summary
type DesignTicketRecord = {
  linearId: string;
  storyId: number;
  storyUrl: string;
  action: 'moved_to_design' | 'created_in_design';
};

// Tickets we updated (existing stories: assignee, type, workflow, epic) for end summary
type UpdatedTicketRecord = {
  linearId: string;
  storyId: number;
  storyUrl: string;
  storyName: string;
};

// Epics we updated (existing epics: planned_start_date, deadline, etc.) for end summary
type UpdatedEpicRecord = {
  name: string;
  id: number;
  startDate?: string;
  deadline?: string;
};

// Objectives we updated (existing objectives: target_date, etc.) for end summary
type UpdatedObjectiveRecord = {
  name: string;
  id: number;
  targetDate?: string;
};

// Migrate a single team
const migrateTeam = async (
  linearTeamId: string,
  linearTeamName: string, // Add team name for migration note
  shortcutTeamId: string,
  shortcutTeamName: string, // Add Shortcut team name for migration note
  limit?: number, // Optional limit for test mode
  designTicketsUpdated?: DesignTicketRecord[],
  allShortcutTeamIdsForDuplicateCheck?: string[], // e.g. [Foundation, Education] so we don't create same story in both
  updatedTickets?: UpdatedTicketRecord[], // Collect tickets we updated (existing stories) for end summary
  updatedEpics?: UpdatedEpicRecord[], // Collect epics we updated (start date, deadline) for end summary
  updatedObjectives?: UpdatedObjectiveRecord[] // Collect objectives we updated (target date) for end summary
): Promise<Result<void>> => {
  const actualLimit = limit || (TEST_MODE ? TEST_LIMIT : 0);
  if (TEST_MODE || limit) {
    console.log(`\n🧪 TEST MODE: Migrating only ${actualLimit} issue(s) for testing`);
  }
  console.log(`\n🚀 Starting migration for Linear team ${linearTeamId} → Shortcut team ${shortcutTeamId}`);

  // Get Shortcut workflows and users
  const workflowsResult = await getShortcutWorkflows(shortcutTeamId);
  if (!workflowsResult.success || !workflowsResult.value) {
    return { success: false, error: 'Failed to fetch Shortcut workflows' };
  }

  // Log available workflow states
  console.log('\n📋 Available Shortcut workflow states:');
  workflowsResult.value.forEach(workflow => {
    console.log(`  Workflow: ${workflow.name}`);
    workflow.states.forEach(state => {
      console.log(`    - ${state.name} (${state.type}) [ID: ${state.id}]`);
    });
  });

  const usersResult = await getShortcutUsers();
  if (!usersResult.success || !usersResult.value) {
    return { success: false, error: 'Failed to fetch Shortcut users' };
  }

  // Get Shortcut iterations for cycle mapping
  const iterationsResult = await getShortcutIterations(shortcutTeamId);
  const shortcutIterations = iterationsResult.success && iterationsResult.value 
    ? iterationsResult.value 
    : [];
  
  // Create a map of cycle number to iteration ID for quick lookup
  const cycleNumberToIterationMap = new Map<number, number>();
  shortcutIterations.forEach((iteration: { id: number; name: string; number: number }) => {
    cycleNumberToIterationMap.set(iteration.number, iteration.id);
  });

  // Get Linear initiatives and create/find objectives
  const initiativesResult = await getLinearInitiatives();
  const initiativeToObjectiveMap = new Map<string, number>();
  
  // Skip epic/objective creation if flag is set
  if (!SKIP_EPIC_OBJECTIVE_CREATION) {
    // Get existing Shortcut objectives to avoid duplicates
    const existingObjectivesResult = await getShortcutObjectives();
    const existingObjectives = existingObjectivesResult.success && existingObjectivesResult.value 
      ? existingObjectivesResult.value 
      : [];

    if (initiativesResult.success && initiativesResult.value) {
    console.log(`\n🎯 Found ${initiativesResult.value.length} initiatives in Linear`);
    console.log(`   Found ${existingObjectives.length} existing objectives in Shortcut`);
    
    for (const initiative of initiativesResult.value) {
      // Check if objective already exists
      const existingObjective = existingObjectives.find(o => o.name === initiative.name);
      const objectiveId = existingObjective?.id;
      
      // Create or update objective with all initiative information
      const objectiveResult = await createOrUpdateShortcutObjective(
        initiative,
        usersResult.value,
        objectiveId,
        updatedObjectives
      );
      
      if (objectiveResult.success && objectiveResult.value) {
        const finalObjectiveId = objectiveResult.value;
        if (existingObjective) {
          console.log(`  ✅ Updated existing objective: "${initiative.name}" (ID: ${finalObjectiveId})`);
        } else {
          console.log(`  ✅ Created new objective: "${initiative.name}" (ID: ${finalObjectiveId})`);
        }
        initiativeToObjectiveMap.set(initiative.id, finalObjectiveId);
      } else {
        console.error(`  ❌ Failed to create/update objective for initiative "${initiative.name}":`, objectiveResult.error);
      }
    }
      console.log(`\n📊 Objective mapping: ${initiativeToObjectiveMap.size} initiatives mapped to objectives`);
    } else {
      console.log(`\n⚠️  No initiatives found in Linear (or failed to fetch)`);
    }
  } else {
    console.log(`\n⏭️  SKIPPING objective creation (SKIP_EPIC_OBJECTIVE_CREATION flag is set)`);
  }

  // Get existing Shortcut epics FIRST - we'll use them for both duplicate detection AND state inference
  console.log(`\n📦 Fetching existing Shortcut epics...`);
  const existingEpicsResult = await getShortcutEpics(shortcutTeamId);
  const existingEpics = existingEpicsResult.success && existingEpicsResult.value 
    ? existingEpicsResult.value 
    : [];
  console.log(`   Found ${existingEpics.length} existing epics in Shortcut`);

  // Infer epic workflow states from existing epics
  let epicWorkflowStates: Array<{ id: number; name: string; type: string }> = [];
  
  if (existingEpics.length > 0) {
    console.log(`\n📊 Inferring epic workflow states from ${existingEpics.length} existing epics...`);
    const stateMap = new Map<number, { id: number; name: string; type: string }>();
    
    for (const epic of existingEpics) {
      if (epic.epic_state_id) {
        // Skip if we already have this state
        if (stateMap.has(epic.epic_state_id)) {
          continue;
        }
        
        // Try to get state name from the epic object
        let stateName = 'Unknown';
        if ((epic as any).state) {
          stateName = typeof (epic as any).state === 'string' ? (epic as any).state : ((epic as any).state.name || 'Unknown');
        }
        
        // Infer type from state name
        const stateNameLower = stateName.toLowerCase();
        let stateType = 'unstarted';
        if (stateNameLower.includes('done') || stateNameLower.includes('completed') || stateNameLower.includes('finish')) {
          stateType = 'done';
        } else if (stateNameLower.includes('progress') || stateNameLower.includes('started') || stateNameLower.includes('active')) {
          stateType = 'started';
        } else if (stateNameLower.includes('do') && !stateNameLower.includes('done')) {
          stateType = 'unstarted';
        }
        
        stateMap.set(epic.epic_state_id, { id: epic.epic_state_id, name: stateName, type: stateType });
      }
    }
    
    if (stateMap.size > 0) {
      epicWorkflowStates = Array.from(stateMap.values());
      console.log(`  ✅ Inferred ${epicWorkflowStates.length} epic state(s) from existing epics:`);
      epicWorkflowStates.forEach(state => {
        console.log(`    - ${state.name} (${state.type}) [ID: ${state.id}]`);
      });
    } else {
      console.error(`  ❌ Could not infer any epic states from existing epics`);
      return { success: false, error: 'Could not infer epic workflow states from existing epics' };
    }
  } else {
    console.error(`❌ No existing epics found in Shortcut - cannot infer epic workflow states`);
    console.error(`   At least one epic must exist to determine valid state IDs`);
    return { success: false, error: 'Cannot determine epic workflow states without existing epics' };
  }

  // Get Linear projects and create/find epics
  const projectsResult = await getLinearProjects(linearTeamId);
  const projectToEpicMap = new Map<string, number>();

  if (!SKIP_EPIC_OBJECTIVE_CREATION && projectsResult.success && projectsResult.value) {
    console.log(`\n📦 Found ${projectsResult.value.length} projects in Linear`);
    console.log(`   Found ${existingEpics.length} existing epics in Shortcut`);
    
    for (const project of projectsResult.value) {
      // Check if epic already exists
      const existingEpic = existingEpics.find(e => e.name === project.name);
      const epicId = existingEpic?.id;
      
      // Get objective ID if project has initiatives (take the first one)
      const objectiveId = project.initiatives && project.initiatives.nodes.length > 0
        ? initiativeToObjectiveMap.get(project.initiatives.nodes[0].id)
        : undefined;
      
      // Create or update epic with all project information
      const epicResult = await createOrUpdateShortcutEpic(
        project,
        shortcutTeamId,
        usersResult.value,
        epicWorkflowStates,
        epicId,
        objectiveId,
        updatedEpics
      );
      
      if (epicResult.success && epicResult.value) {
        const finalEpicId = epicResult.value;
        const mappedStateId = mapProjectStateToEpicStateId(project, epicWorkflowStates);
        const stateName = epicWorkflowStates.find(s => s.id === mappedStateId)?.name || 'unknown';
        const linearStateInfo = project.status 
          ? `${project.status.name} (type: ${project.status.type})`
          : project.state;
        if (existingEpic) {
          // Only log update details if we actually updated (UPDATE_EXISTING_EPICS = true)
          if (UPDATE_EXISTING_EPICS) {
            console.log(`  ✅ Updated existing epic: "${project.name}" (ID: ${finalEpicId})`);
            console.log(`     State: ${linearStateInfo} → ${stateName} (ID: ${mappedStateId})`);
            if (objectiveId && project.initiatives && project.initiatives.nodes.length > 0) {
              console.log(`     Objective ID: ${objectiveId} (linked to "${project.initiatives.nodes[0].name}")`);
            }
            if (project.description) {
              console.log(`     Description: ${project.description.substring(0, 50)}${project.description.length > 50 ? '...' : ''}`);
            }
          }
          // Epic exists and was used for mapping (either updated or just referenced)
        } else {
          console.log(`  ✅ Created new epic: "${project.name}" (ID: ${finalEpicId})`);
          console.log(`     State: ${linearStateInfo} → ${stateName} (ID: ${mappedStateId})`);
          if (objectiveId && project.initiatives && project.initiatives.nodes.length > 0) {
            console.log(`     Objective ID: ${objectiveId} (linked to "${project.initiatives.nodes[0].name}")`);
          }
        }
        projectToEpicMap.set(project.id, finalEpicId);
      } else {
        console.error(`  ❌ Failed to create/update epic for project "${project.name}":`, epicResult.error);
      }
    }
    console.log(`\n📊 Epic mapping: ${projectToEpicMap.size} projects mapped to epics`);
  } else if (SKIP_EPIC_OBJECTIVE_CREATION) {
    console.log(`\n⏭️  SKIPPING epic creation (SKIP_EPIC_OBJECTIVE_CREATION flag is set)`);
  } else {
    console.log(`\n⚠️  No projects found in Linear (or failed to fetch)`);
  }

  // Get Linear issues
  const issuesResult = await getLinearIssues(linearTeamId);
  if (!issuesResult.success || !issuesResult.value) {
    console.error(`❌ Error fetching Linear issues:`, issuesResult.error);
    return { success: false, error: `Failed to fetch Linear issues: ${issuesResult.error}` };
  }

  const issues: LinearIssue[] = issuesResult.value;
  console.log(`Found ${issues.length} issues to migrate`);
  
  // Log project assignment statistics
  const issuesWithProjects = issues.filter(i => i.project);
  const issuesWithoutProjects = issues.filter(i => !i.project);
  console.log(`  📊 Issues with projects: ${issuesWithProjects.length}`);
  console.log(`  📊 Issues without projects: ${issuesWithoutProjects.length}`);
  if (issuesWithProjects.length > 0) {
    console.log(`  📊 Projects assigned: ${Array.from(new Set(issuesWithProjects.map(i => i.project?.name))).join(', ')}`);
  }

  // In test mode, prioritize parent issues with projects to test epic attachment
  let issuesToProcess = issues;
  if (TEST_MODE || actualLimit > 0) {
    // First, try to find parent issues (not child issues) with projects
    const parentIssuesWithProjects = issues.filter(i => !i.parent && i.project);
    if (parentIssuesWithProjects.length > 0) {
      console.log(`  🧪 TEST MODE: Found ${parentIssuesWithProjects.length} parent issue(s) with projects - prioritizing for epic attachment test`);
      issuesToProcess = parentIssuesWithProjects.slice(0, actualLimit);
    } else if (issuesWithProjects.length > 0) {
      console.log(`  ⚠️  TEST MODE: All issues with projects are child issues. Using first issue with project (will be handled as subtask)`);
      issuesToProcess = issuesWithProjects.slice(0, actualLimit);
    } else {
      console.log(`  ⚠️  TEST MODE: No issues with projects found - using first issue (epic attachment cannot be tested)`);
      issuesToProcess = issues.slice(0, actualLimit);
    }
    console.log(`🧪 TEST MODE: Processing only ${issuesToProcess.length} issue(s) for testing`);
  }

  // Discover and log unique Linear statuses (from all issues, not just test subset)
  const uniqueStatuses = Array.from(new Set(issues.map(issue => issue.state.name)));
  console.log(`\n📊 Found ${uniqueStatuses.length} unique Linear statuses:`);
  uniqueStatuses.forEach(status => {
    console.log(`  - ${status}`);
  });

  // Separate parent and child issues - both will be created as stories
  const parentIssues = issuesToProcess.filter(issue => !issue.parent);
  const childIssues = issuesToProcess.filter(issue => issue.parent);
  
  // Log child issues info
  if (childIssues.length > 0) {
    console.log(`\n📋 Found ${childIssues.length} child issue(s) - will be created as separate stories`);
  }

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const issueToStoryMap = new Map<string, number>();
  const createdStories: Array<{ linearId: string; storyId: number; storyUrl: string; storyName: string }> = [];

  // Migrate parent issues
  const statusMappingLog = new Map<string, string>();
  
  // In test mode, show which issue is being migrated
  if (TEST_MODE || limit) {
    console.log(`\n🧪 TEST MODE: Migrating issue: ${parentIssues[0]?.identifier || 'N/A'} - "${parentIssues[0]?.title || 'N/A'}"`);
  }
  
  for (const issue of parentIssues) {
    // Log project info for debugging
    if (issue.project) {
      console.log(`  📋 Issue ${issue.identifier} has project: "${issue.project.name}" (ID: ${issue.project.id})`);
    } else {
      console.log(`  📋 Issue ${issue.identifier} has no project assigned in Linear`);
    }
    
    const epicId = issue.project ? projectToEpicMap.get(issue.project.id) : undefined;
    
    // Log epic attachment info
    if (epicId) {
      console.log(`  📎 Attaching issue ${issue.identifier} to epic ID: ${epicId} (project: ${issue.project?.name})`);
    } else if (issue.project) {
      console.warn(`  ⚠️  Issue ${issue.identifier} has project "${issue.project.name}" (ID: ${issue.project.id}) but epic not found in map`);
      console.warn(`     Available project IDs in map: ${Array.from(projectToEpicMap.keys()).join(', ')}`);
    }
    
    // Log status mapping (only once per unique status)
    if (!statusMappingLog.has(issue.state.name)) {
      const workflowStateId = mapStatusToWorkflowState(issue.state.name, workflowsResult.value);
      if (workflowStateId) {
        const allStates: Array<{ id: number; name: string; type: string }> = [];
        workflowsResult.value.forEach(workflow => {
          allStates.push(...workflow.states);
        });
        const mappedState = allStates.find(s => s.id === workflowStateId);
        if (mappedState) {
          statusMappingLog.set(issue.state.name, mappedState.name);
          console.log(`  📌 Mapping: "${issue.state.name}" → "${mappedState.name}"`);
        }
      }
    }
    
    // Map cycle to iteration if available
    const iterationId = issue.cycle ? cycleNumberToIterationMap.get(issue.cycle.number) : undefined;
    
    const storyResult = await createShortcutStory(
      issue,
      shortcutTeamId,
      shortcutTeamName, // Pass team name for migration note
      workflowsResult.value,
      usersResult.value,
      epicId,
      iterationId,
      allShortcutTeamIdsForDuplicateCheck
    );

    if (storyResult.success && storyResult.value) {
      issueToStoryMap.set(issue.id, storyResult.value);
      
      // Check if this was a duplicate (error field will be 'duplicate' if it was skipped)
      if (storyResult.error === 'duplicate') {
        skippedCount++;
        // Get story details to show URL and epic info
        const existingStory = await getStoryDetails(storyResult.value);
        const storyUrl = existingStory.success && existingStory.value 
          ? (existingStory.value.app_url || existingStory.value.url || `https://app.shortcut.com/story/${storyResult.value}`)
          : `https://app.shortcut.com/story/${storyResult.value}`;
        const storyName = existingStory.success && existingStory.value ? existingStory.value.name : 'Unknown';
        const storyData = existingStory.success && existingStory.value ? existingStory.value : null;
        const existingEpicId = storyData ? (storyData as any).epic_id : null;
        
        console.log(`  ⏭️  Skipped duplicate: ${issue.identifier} (already exists as story ${storyResult.value})`);
        console.log(`     Existing Story: "${storyName}"`);
        console.log(`     Story URL: ${storyUrl}`);
        
        // Check if story has epic attached, and update if needed
        if (existingEpicId) {
          console.log(`     Epic ID: ${existingEpicId} (already attached)`);
        } else if (epicId) {
          // Story should have an epic but doesn't - update it
          console.log(`     ⚠️  Story missing epic - attaching to epic ID ${epicId}...`);
          const updateResult = await shortcutApiRequest<ShortcutStory>(
            `/stories/${storyResult.value}`,
            'PUT',
            { epic_id: epicId }
          );
          if (updateResult.success) {
            console.log(`     ✅ Attached story to epic ID ${epicId}`);
          } else {
            console.warn(`     ⚠️  Failed to attach epic: ${updateResult.error}`);
          }
        } else {
          console.log(`     Epic: None (issue has no project in Linear)`);
        }
        
        // Update assignee for existing story if needed
        if (issue.assignee && issue.assignee.email) {
          console.log(`     🔄 Updating assignee for existing story...`);
          const assigneeUpdateResult = await updateStoryAssignee(storyResult.value, issue, usersResult.value);
          if (!assigneeUpdateResult.success) {
            console.error(`     ❌ Failed to update assignee:`, assigneeUpdateResult.error);
          }
        }
        
        // Update story type if needed (retroactive fix for bugs)
        const currentStoryType = storyData ? (storyData as any).story_type : undefined;
        const typeUpdateResult = await updateStoryType(storyResult.value, issue, currentStoryType);
        if (!typeUpdateResult.success) {
          console.error(`     ❌ Failed to update story type:`, typeUpdateResult.error);
        }
        
        // Update workflow state if needed (retroactive fix for Design tickets)
        const currentWorkflowStateId = storyData ? (storyData as any).workflow_state_id : undefined;
        const workflowStateUpdateResult = await updateStoryWorkflowState(storyResult.value, issue, workflowsResult.value, currentWorkflowStateId);
        if (!workflowStateUpdateResult.success) {
          console.error(`     ❌ Failed to update workflow state:`, workflowStateUpdateResult.error);
        } else if (workflowStateUpdateResult.value?.updated) {
          const hasDesignLabel = issue.labels.nodes.some(l => l.name.toLowerCase() === 'design' || l.name.toLowerCase().includes('design'));
          if (hasDesignLabel && designTicketsUpdated) {
            designTicketsUpdated.push({
              linearId: issue.identifier,
              storyId: storyResult.value,
              storyUrl: `https://app.shortcut.com/studocu/story/${storyResult.value}`,
              action: 'moved_to_design',
            });
          }
        }
        // Record for end summary: tickets we updated (assignee, type, workflow, epic)
        if (updatedTickets) {
          updatedTickets.push({
            linearId: issue.identifier,
            storyId: storyResult.value,
            storyUrl,
            storyName,
          });
        }
      } else {
        // New story was created - get details to show URL
        const newStory = await getStoryDetails(storyResult.value);
        const storyUrl = newStory.success && newStory.value 
          ? (newStory.value.app_url || newStory.value.url || `https://app.shortcut.com/story/${storyResult.value}`)
          : `https://app.shortcut.com/story/${storyResult.value}`;
        const storyName = newStory.success && newStory.value ? newStory.value.name : issue.title;
        
        createdStories.push({
          linearId: issue.identifier,
          storyId: storyResult.value,
          storyUrl,
          storyName,
        });
        const hasDesignLabel = issue.labels.nodes.some(l => l.name.toLowerCase() === 'design' || l.name.toLowerCase().includes('design'));
        if (hasDesignLabel && designTicketsUpdated) {
          designTicketsUpdated.push({
            linearId: issue.identifier,
            storyId: storyResult.value,
            storyUrl,
            action: 'created_in_design',
          });
        }
        
        successCount++;
        if (successCount % 10 === 0) {
          console.log(`  ✅ Migrated ${successCount} new issues...`);
        }
      }
    } else {
      errorCount++;
      console.error(`❌ Failed to migrate issue ${issue.identifier}:`, storyResult.error);
    }

    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Migrate child issues as separate stories (not subtasks)
  // They will be linked to their parent story via relationship
  // First, find parent identifiers for child issues
  const parentIdToIdentifier = new Map<string, string>();
  for (const issue of issues) {
    if (!issue.parent) {
      parentIdToIdentifier.set(issue.id, issue.identifier);
    }
  }
  
  for (const childIssue of childIssues) {
    const parentIssueId = childIssue.parent!.id;
    const parentIdentifier = parentIdToIdentifier.get(parentIssueId);
    const parentStoryId = issueToStoryMap.get(parentIssueId);
    
    // Get epic for child issue (child issues can also have projects/epics)
    const epicId = childIssue.project ? projectToEpicMap.get(childIssue.project.id) : undefined;
    
    // Log child issue info
    if (parentStoryId) {
      console.log(`\n  📎 Migrating child issue ${childIssue.identifier} (parent story: ${parentStoryId})`);
    } else {
      console.log(`\n  ⚠️  Migrating child issue ${childIssue.identifier} (parent not migrated yet)`);
    }
    
    if (epicId) {
      console.log(`  📎 Attaching child issue ${childIssue.identifier} to epic ID: ${epicId} (project: ${childIssue.project?.name})`);
    }
    
    // Map cycle to iteration if available
    const childIterationId = childIssue.cycle ? cycleNumberToIterationMap.get(childIssue.cycle.number) : undefined;
    
    // Create child issue as a separate story
    const childStoryResult = await createShortcutStory(
      childIssue,
      shortcutTeamId,
      shortcutTeamName, // Pass team name for migration note
      workflowsResult.value,
      usersResult.value,
      epicId,
      childIterationId,
      allShortcutTeamIdsForDuplicateCheck
    );

    if (childStoryResult.success && childStoryResult.value) {
      issueToStoryMap.set(childIssue.id, childStoryResult.value);
      
      // Check if this was a duplicate
      if (childStoryResult.error === 'duplicate') {
        skippedCount++;
        const existingStory = await getStoryDetails(childStoryResult.value);
        const storyUrl = existingStory.success && existingStory.value 
          ? (existingStory.value.app_url || existingStory.value.url || `https://app.shortcut.com/story/${childStoryResult.value}`)
          : `https://app.shortcut.com/story/${childStoryResult.value}`;
        const storyName = existingStory.success && existingStory.value ? existingStory.value.name : 'Unknown';
        const storyData = existingStory.success && existingStory.value ? existingStory.value : null;
        const existingEpicId = storyData ? (storyData as any).epic_id : null;
        
        console.log(`  ⏭️  Skipped duplicate child issue: ${childIssue.identifier} (already exists as story ${childStoryResult.value})`);
        console.log(`     Existing Story: "${storyName}"`);
        console.log(`     Story URL: ${storyUrl}`);
        
        // Update epic if needed
        if (existingEpicId) {
          console.log(`     Epic ID: ${existingEpicId} (already attached)`);
        } else if (epicId) {
          console.log(`     ⚠️  Story missing epic - attaching to epic ID ${epicId}...`);
          const updateResult = await shortcutApiRequest<ShortcutStory>(
            `/stories/${childStoryResult.value}`,
            'PUT',
            { epic_id: epicId }
          );
          if (updateResult.success) {
            console.log(`     ✅ Attached story to epic ID ${epicId}`);
          } else {
            console.warn(`     ⚠️  Failed to attach epic: ${updateResult.error}`);
          }
        }
        
        // Update story type if needed (retroactive fix for bugs)
        const currentChildStoryType = storyData ? (storyData as any).story_type : undefined;
        const childTypeUpdateResult = await updateStoryType(childStoryResult.value, childIssue, currentChildStoryType);
        if (!childTypeUpdateResult.success) {
          console.error(`     ❌ Failed to update story type:`, childTypeUpdateResult.error);
        }
        
        // Try to add relationship to parent if parent exists
        if (parentStoryId) {
          try {
            // Shortcut API uses /stories/{story-id}/story-links endpoint
            const relationshipResult = await shortcutApiRequest<any>(
              `/stories/${childStoryResult.value}/story-links`,
              'POST',
              {
                object_id: parentStoryId,
                verb: 'relates to',
              }
            );
            if (relationshipResult.success) {
              console.log(`     ✅ Added relationship to parent story ${parentStoryId}${parentIdentifier ? ` (${parentIdentifier})` : ''}`);
            } else {
              console.warn(`     ⚠️  Could not add relationship to parent: ${relationshipResult.error}`);
            }
          } catch (error) {
            // Relationship creation is optional
            console.warn(`     ⚠️  Could not add relationship to parent: ${error}`);
          }
        }
        if (updatedTickets) {
          updatedTickets.push({
            linearId: childIssue.identifier,
            storyId: childStoryResult.value,
            storyUrl,
            storyName,
          });
        }
      } else {
        // New story was created
        const newStory = await getStoryDetails(childStoryResult.value);
        const storyUrl = newStory.success && newStory.value 
          ? (newStory.value.app_url || newStory.value.url || `https://app.shortcut.com/story/${childStoryResult.value}`)
          : `https://app.shortcut.com/story/${childStoryResult.value}`;
        const storyName = newStory.success && newStory.value ? newStory.value.name : childIssue.title;
        
        createdStories.push({
          linearId: childIssue.identifier,
          storyId: childStoryResult.value,
          storyUrl,
          storyName,
        });
        
        successCount++;
        console.log(`  ✅ Created child issue as story: ${childIssue.identifier} → Story #${childStoryResult.value}`);
        console.log(`     Story URL: ${storyUrl}`);
        if (epicId) {
          console.log(`     Epic ID: ${epicId} (attached)`);
        }
        
        // Try to add relationship to parent if parent exists
        if (parentStoryId) {
          try {
            // Shortcut API uses /stories/{story-id}/story-links endpoint
            const relationshipResult = await shortcutApiRequest<any>(
              `/stories/${childStoryResult.value}/story-links`,
              'POST',
              {
                object_id: parentStoryId,
                verb: 'relates to',
              }
            );
            if (relationshipResult.success) {
              console.log(`     ✅ Added relationship to parent story ${parentStoryId}${parentIdentifier ? ` (${parentIdentifier})` : ''}`);
            } else {
              console.warn(`     ⚠️  Could not add relationship to parent: ${relationshipResult.error}`);
            }
          } catch (error) {
            // Relationship creation is optional, don't fail if it doesn't work
            console.warn(`     ⚠️  Could not add relationship to parent: ${error}`);
          }
        }
      }
    } else {
      errorCount++;
      console.error(`  ❌ Failed to migrate child issue ${childIssue.identifier}:`, childStoryResult.error);
    }

    // Add small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log(`\n✅ Migration complete! Created: ${successCount}, Skipped (duplicates): ${skippedCount}, Errors: ${errorCount}`);
  
  // Print summary of created stories for verification
  if (createdStories.length > 0) {
    console.log(`\n📝 Created Stories (${createdStories.length}):`);
    createdStories.forEach(story => {
      console.log(`   ${story.linearId} → Story #${story.storyId}: "${story.storyName}"`);
      console.log(`      URL: ${story.storyUrl}`);
    });
  }
  
  if (skippedCount > 0) {
    console.log(`\n⏭️  Skipped ${skippedCount} duplicate(s) - check logs above for existing story URLs`);
  }
  
  return { success: true, value: undefined };
};

// Main migration function
const main = async (): Promise<void> => {
  // Reload .env in case main is called after env changed
  dotenv.config({ path: path.join(fs.existsSync(path.join(process.cwd(), '.env')) ? process.cwd() : path.join(__dirname, '..'), '.env') });

  if (!LINEAR_API_TOKEN || !String(LINEAR_API_TOKEN).trim()) {
    console.error('❌ LINEAR_API_TOKEN is not set. Check that .env exists in the project root and contains LINEAR_API_TOKEN=...');
    console.error('   Current working directory:', process.cwd());
    return;
  }

  if (!SHORTCUT_API_TOKEN || !String(SHORTCUT_API_TOKEN).trim()) {
    console.error('❌ SHORTCUT_API_TOKEN is not set. Check that .env exists in the project root and contains SHORTCUT_API_TOKEN=...');
    console.error('   Current working directory:', process.cwd());
    return;
  }

  if (TEST_MODE) {
    console.log(`🧪 TEST MODE ENABLED - Migrating only ${TEST_LIMIT} issue(s) for testing\n`);
  }
  console.log('🔄 Starting Linear to Shortcut migration...\n');

  // Try automatic team discovery first
  let teamMappings: Array<{ linearTeamId: string; shortcutTeamId: string; linearTeamName: string; shortcutTeamName: string }> = [];

  const discoveryResult = await discoverTeamMappings();
  if (discoveryResult.success && discoveryResult.value) {
    teamMappings = discoveryResult.value;
    console.log(`\n✅ Discovered ${teamMappings.length} team mappings automatically\n`);
  } else {
    // Fallback to environment variable mappings
    console.log('⚠️  Automatic team discovery failed, trying environment variables...\n');
    if (discoveryResult.error) {
      console.warn('   Discovery error:', typeof discoveryResult.error === 'string' ? discoveryResult.error : (discoveryResult.error as Error)?.message || String(discoveryResult.error));
    }
    const validMappings = TEAM_MAPPING.filter(
      m => m.linearTeamId && m.shortcutTeamId
    );

    if (validMappings.length === 0) {
      console.error('❌ No valid team mappings found.');
      console.error('   Please either:');
      console.error('   1. Ensure teams exist in both Linear and Shortcut with matching names');
      console.error('   2. Or set LINEAR_TEAM_1_ID, SHORTCUT_TEAM_1_ID, etc. in .env');
      return;
    }

    // Convert to format with names (we'll fetch names later if needed)
    teamMappings = validMappings.map(m => ({
      linearTeamId: m.linearTeamId,
      shortcutTeamId: m.shortcutTeamId,
      linearTeamName: 'Unknown',
      shortcutTeamName: 'Unknown',
    }));
  }

  if (teamMappings.length === 0) {
    console.error('❌ No teams to migrate');
    return;
  }

  // In test mode, prioritize Education AND Foundation teams (migrate both), otherwise use first team
  let teamsToMigrate = teamMappings;
  if (TEST_MODE) {
    // Prioritize Education AND Foundation teams for testing (migrate BOTH)
    const priorityTeams = teamMappings.filter(m => 
      m.shortcutTeamName.includes('Education') || 
      m.shortcutTeamName.includes('Foundation')
    );
    
    if (priorityTeams.length > 0) {
      teamsToMigrate = priorityTeams; // Migrate ALL priority teams (both Education and Foundation)
      console.log(`🧪 TEST MODE: Migrating ${teamsToMigrate.length} priority team(s):`);
      teamsToMigrate.forEach(t => console.log(`  - ${t.linearTeamName} → ${t.shortcutTeamName}`));
    } else {
      teamsToMigrate = teamMappings.slice(0, 1);
      console.log(`🧪 TEST MODE: Only migrating first team (${teamsToMigrate[0]?.linearTeamName})`);
    }
  }

  // Collect Design tickets, updated tickets, epics, and objectives for end summary
  const designTicketsUpdated: DesignTicketRecord[] = [];
  const updatedTickets: UpdatedTicketRecord[] = [];
  const updatedEpics: UpdatedEpicRecord[] = [];
  const updatedObjectives: UpdatedObjectiveRecord[] = [];

  // Migrate each team
  for (const mapping of teamsToMigrate) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Migrating: ${mapping.linearTeamName} → ${mapping.shortcutTeamName}`);
    console.log(`${'='.repeat(60)}`);
    
    const allShortcutTeamIds = teamsToMigrate.map(m => m.shortcutTeamId);
    const result = await migrateTeam(
      mapping.linearTeamId,
      mapping.linearTeamName,
      mapping.shortcutTeamId,
      mapping.shortcutTeamName,
      TEST_MODE ? TEST_LIMIT : undefined,
      designTicketsUpdated,
      allShortcutTeamIds,
      updatedTickets,
      updatedEpics,
      updatedObjectives
    );
    if (!result.success) {
      console.error(`❌ Migration failed for team ${mapping.linearTeamName}:`, result.error);
    }
  }

  // List epics we updated (start date, deadline - including Q4 2025 → last day of quarter)
  if (updatedEpics.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('📦 EPICS UPDATED – verify dates in Shortcut');
    console.log('='.repeat(60));
    console.log(`\n  ${updatedEpics.length} epic(s) updated (no duplicates created):\n`);
    updatedEpics.forEach((e, i) => {
      const dates = [e.startDate && `Start: ${e.startDate}`, e.deadline && `Deadline: ${e.deadline}`].filter(Boolean).join(', ');
      console.log(`  ${i + 1}. ${e.name} (ID: ${e.id})${dates ? `  ${dates}` : ''}`);
      console.log(`     https://app.shortcut.com/studocu/epic/${e.id}`);
    });
    console.log('\n  Open the links above to confirm planned start date and deadline.\n');
  }

  // List objectives we updated (target date)
  if (updatedObjectives.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 OBJECTIVES UPDATED – verify dates in Shortcut');
    console.log('='.repeat(60));
    console.log(`\n  ${updatedObjectives.length} objective(s) updated (no duplicates created):\n`);
    updatedObjectives.forEach((o, i) => {
      console.log(`  ${i + 1}. ${o.name} (ID: ${o.id})${o.targetDate ? `  Target date: ${o.targetDate}` : ''}`);
    });
    console.log('\n  Verify target dates in Shortcut.\n');
  }

  // List tickets we updated (existing stories: assignee, type, workflow, epic) so you can verify in Shortcut
  if (updatedTickets.length > 0) {
    console.log('\n' + '='.repeat(60));
    console.log('📋 TICKETS UPDATED – verify in Shortcut');
    console.log('='.repeat(60));
    console.log(`\n  ${updatedTickets.length} existing ticket(s) were updated (no duplicates created):\n`);
    updatedTickets.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.linearId} → Story #${t.storyId}  "${t.storyName}"`);
      console.log(`     ${t.storyUrl}`);
    });
    console.log('\n  Open the links above to confirm assignee, type, workflow, and epic are correct.\n');
  }

  // List Design tickets that were updated or created so you can verify they're in the Design workflow
  if (designTicketsUpdated.length > 0) {
    const moved = designTicketsUpdated.filter(d => d.action === 'moved_to_design');
    const created = designTicketsUpdated.filter(d => d.action === 'created_in_design');
    console.log('\n' + '='.repeat(60));
    console.log('🎨 DESIGN TICKETS – verify workflow in Shortcut');
    console.log('='.repeat(60));
    if (moved.length > 0) {
      console.log(`\n  Moved to Design workflow (${moved.length}):`);
      moved.forEach(d => {
        console.log(`    • ${d.linearId} → Story #${d.storyId}  ${d.storyUrl}`);
      });
    }
    if (created.length > 0) {
      console.log(`\n  Created in Design workflow (${created.length}):`);
      created.forEach(d => {
        console.log(`    • ${d.linearId} → Story #${d.storyId}  ${d.storyUrl}`);
      });
    }
    console.log('\n  Open the links above and confirm each story shows Workflow: Design.\n');
  }

  console.log('\n🎉✨ Migration process completed! 🚀📊');
};

main().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
