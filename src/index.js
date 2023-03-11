const env = require("dotenv");
const z = require("zod");
const { Octokit } = require("@octokit/rest");

const EnvConfigSchema = z.object({
  GITHUB_TOKEN: z.string(),
  GITHUB_REPOSITORY: z.string().includes("/"),
  GITHUB_PR: z.string(),
});

env.config();
const config = EnvConfigSchema.parse(process.env);

main();
async function main() {
  const github = new Octokit({
    auth: config.GITHUB_TOKEN,
  });

  const [owner, repo] = config.GITHUB_REPOSITORY.split("/");
  const { data: pullRequest } = await github.pulls.get({
    owner,
    repo,
    pull_number: parseInt(config.GITHUB_PR),
  });

  const { data: commit } = await github.git.getCommit({
    owner,
    repo,
    commit_sha: pullRequest.merge_commit_sha,
  });

  const { data: tree } = await github.git.getTree({
    owner,
    repo,
    tree_sha: commit.tree.sha,
  });

  const packagesFolder = tree.tree.find(i => i.path === "packages");

  const { data: subTree } = await github.git.getTree({
    owner,
    repo,
    tree_sha: packagesFolder?.sha,
  });

  const gitIgnoreFile = tree.tree.find(i => i.path === ".gitignore");

  const { data: blob } = await github.git.getBlob({
    owner,
    repo,
    file_sha: gitIgnoreFile?.sha,
  });

  console.log(Buffer.from(blob.content, "base64").toString());
}
