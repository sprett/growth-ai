import { App } from '@octokit/app'

const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
})

const octokit = await app.getInstallationOctokit(process.env.GITHUB_APP_INSTALLATION_ID)
const { data } = await octokit.request('GET /repos/{owner}/{repo}', {
  owner: 'denizsaether',
  repo: 'Student_app'
})
console.log('✅ Repo funnet:', data.full_name)