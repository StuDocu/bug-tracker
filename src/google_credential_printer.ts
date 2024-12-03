import * as fs from 'fs';

const filePath = '../google_secrets.json';

try {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const base64FileContent = Buffer.from(fileContent).toString('base64');
  console.log("Your Google Credential is: ", base64FileContent);
} catch (error) {
  if (error instanceof Error) {
    console.error(`Error reading or encoding file: ${error.message}`);
  } else {
    console.error('Unknown error occurred');
  }
}