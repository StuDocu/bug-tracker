# bug-tracker

A collection of scripts for managing bug tracking and project migration between Linear and Shortcut.

## Scripts

### 1. Bug Tracker (`script.ts`)
Fetches bug-type cards from Shortcut and writes them to Google Sheets.

### 2. Linear to Shortcut Migration (`linear-to-shortcut-migration.ts`)
Migrates work items (issues, projects, teams) from Linear to Shortcut project management tools.

## Linear to Shortcut Migration

This script migrates work from two Linear teams to Shortcut, mapping concepts between the two platforms.

### Concept Mapping

| Linear Concept | Shortcut Equivalent | Notes |
|---------------|---------------------|-------|
| Team | Team | Direct mapping |
| Project | Epic | Linear projects become Shortcut epics |
| Issue | Story | Each Linear issue becomes a Shortcut story |
| Sub-issue | Subtask | Child issues become subtasks under parent stories |
| Status | Workflow State | Status names are mapped to workflow states |
| Labels | Labels | Labels are created or matched in Shortcut |
| Assignee | Owner | User email matching between platforms |
| Priority | Priority | Preserved where supported |
| Estimate | Estimate | Story points/estimates are preserved |

### Setup

1. **Environment Variables**

   Create a `.env` file with the following **required** variables:

   ```env
   # Linear API Configuration (REQUIRED)
   LINEAR_API_TOKEN=your_linear_api_token

   # Shortcut API Configuration (REQUIRED)
   SHORTCUT_API_TOKEN=your_shortcut_api_token

   # Test Mode (OPTIONAL) - Set to true to migrate only 1 issue for testing
   TEST_MODE=true
   ```

   **Optional** (only needed if automatic team discovery fails):
   ```env
   # Team ID mappings (OPTIONAL - fallback only)
   # The script automatically discovers teams, so these are usually not needed
   LINEAR_TEAM_1_ID=linear_team_1_id
   SHORTCUT_TEAM_1_ID=shortcut_team_1_id
   LINEAR_TEAM_2_ID=linear_team_2_id
   SHORTCUT_TEAM_2_ID=shortcut_team_2_id
   ```

2. **Get API Tokens**

   - **Linear**: Create an API key at https://linear.app/settings/api
   - **Shortcut**: Create an API token at https://app.shortcut.com/settings/api-tokens

3. **Team Discovery**

   The script **automatically discovers and maps teams** by name, so you don't need to manually set team IDs. It will:
   - Find all teams in Linear (including subteams)
   - Find all teams in Shortcut
   - Automatically map them using the `TEAM_NAME_MAPPING` configuration
   - Skip "Product Ideas" team automatically
   - Map "Inputs" team to Foundation

   Team ID environment variables are only used as a fallback if automatic discovery fails.

4. **Status Mappings**

   The script includes explicit status mappings for tickets, epics, and objectives. These are pre-configured in `src/linear-to-shortcut-migration.ts`:
   
   - **STATUS_MAPPING**: Maps Linear issue statuses to Shortcut workflow states (with exact emoji matching)
   - **EPIC_STATUS_MAPPING**: Maps Linear project statuses to Shortcut epic states
   - **OBJECTIVE_STATUS_MAPPING**: Maps Linear initiative statuses to Shortcut objective states
   
   The script handles emojis in both Linear and Shortcut state names automatically. See the "Status Mappings" section below for details.

### Usage

1. **Build the TypeScript files:**
   ```bash
   npm run build
   ```

2. **Test with one issue first (recommended):**
   
   Add to your `.env` file:
   ```env
   TEST_MODE=true
   ```
   
   Then run:
   ```bash
   npm run migrate
   ```
   
   This will migrate only 1 issue from the first team to verify everything works.

3. **Run full migration:**
   
   Remove or set `TEST_MODE=false` in your `.env` file, then:
   ```bash
   npm run migrate
   ```

   Or directly:
   ```bash
   node dist/linear-to-shortcut-migration.js
   ```

### What Gets Migrated

- ✅ **Initiatives** → Objectives (with descriptions and target dates)
- ✅ **Projects** → Epics (with descriptions, states, dates, leads, members, teams, labels)
- ✅ **Issues** → Stories (with all metadata including assignees, priority, cycle, story points, labels)
- ✅ **Sub-issues** → Separate Stories with parent relationships
- ✅ **Labels** → (Design and Bug)Labels (created if they don't exist)
- ✅ **Assignees** → Owners (matched by email)
- ✅ **Estimates** → Story Points (preserved)
- ✅ **Due Dates** → Deadlines (preserved)
- ✅ **Status** → Workflow States (mapped with emoji support)
- ✅ **Descriptions** → Descriptions (with migration metadata)

### Migration Metadata

Each migrated story includes metadata(Stamp) in its description:
- Original Linear identifier
- Original Linear ID
- Creation and update timestamps

## Status Mappings

The script uses explicit status mappings to ensure accurate migration between Linear and Shortcut:

### Tickets/Stories Status Mapping
Linear issue statuses → Shortcut workflow states (with exact emoji matching):
- `Backlog` → `Parking lot 🚗`
- `Refinement` → `Refinement 🔄`
- `Ready to be Prioritized` → `Ready to be Prioritized 🔢`
- `Ready 🏁` → `Ready 🏁`
- `In Progress 💪` → `Implementation In Progress 💪`
- `In Review 🕵` → `Review In Progress 🕵️‍♀️`
- `User Acceptance 🧑‍💻` → `User Acceptance In Progress 🧑‍💻`
- `Done ✅` → `Done ✅`
- `Canceled` → `Parking lot 🚗`
- `Duplicate` → `Done ✅`
- `Triage` → `Inbox 📥`

### Projects/Epics Status Mapping
Linear project statuses → Shortcut epic states:
- `Backlog` → `To Do`
- `Later` → `To Do`
- `Next` → `To Do`
- `Now` → `In Progress`
- `Completed` → `Done`
- `Canceled` → `Discarded`

### Initiatives/Objectives Status Mapping
Linear initiative statuses → Shortcut objective states:
- `Planned` → `To Do`
- `Active` → `In Progress`
- `Completed` → `Done`

The script handles emojis in both Linear and Shortcut state names, ensuring accurate matching even when emoji variations exist.

### Notes

- The script handles pagination automatically for large datasets
- Rate limiting is handled with small delays between requests
- Child issues are migrated as separate stories with parent relationships
- Labels are automatically created in Shortcut if they don't exist
- Users are matched by email address between platforms
- Failed migrations are logged but don't stop the process
- The script is idempotent - safe to run multiple times without creating duplicates

### Error Handling

The script will:
- Continue migrating other items if one fails
- Log all errors with details
- Provide a summary of successful and failed migrations
- Exit with error code 1 if fatal errors occur
