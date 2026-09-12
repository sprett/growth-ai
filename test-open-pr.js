import { App } from '@octokit/app'

const app = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
})

const octokit = await app.getInstallationOctokit(process.env.GITHUB_APP_INSTALLATION_ID)

const owner = 'denizsaether'
const repo = 'Student_App'
const baseBranch = 'main'
const newBranch = 'test-agent-pr'

async function openTestPr() {
  const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner, repo, ref: `heads/${baseBranch}`
  })
  const baseSha = ref.object.sha

  await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner, repo,
    ref: `refs/heads/${newBranch}`,
    sha: baseSha
  })
  console.log('✅ Branch opprettet:', newBranch)

  const { data: file } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
    owner, repo, path: 'README.md', ref: newBranch
  })

  const newContent = Buffer.from(file.content, 'base64').toString('utf8') + '\n\nTest fra growth-ai agent.'
  await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner, repo, path: 'README.md',
    message: 'Test commit fra growth-ai agent',
    content: Buffer.from(newContent).toString('base64'),
    sha: file.sha,
    branch: newBranch
  })
  console.log('✅ Fil oppdatert')

  const { data: pr } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner, repo,
    title: 'Test PR fra growth-ai agent',
    head: newBranch,
    base: baseBranch,
    body: 'Dette er en test for å bekrefte at agenten kan åpne PR-er.'
  })
  console.log('✅ PR åpnet:', pr.html_url)
}

openTestPr().catch(err => console.error('❌ Feil:', err.message, err.response?.data))
