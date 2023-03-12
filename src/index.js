const env = require("dotenv");
const z = require("zod");
const { Octokit } = require("@octokit/rest");
const neo4j = require('neo4j-driver')


const EnvConfigSchema = z.object({
  GITHUB_TOKEN: z.string(),
  GITHUB_REPOSITORY: z.string().includes("/"),
  GITHUB_PR: z.string(),
  DATABASE_URL: z.string(),
  DATABASE_USERNAME: z.string(),
  DATABASE_PASSWORD: z.string()
});

env.config();
const config = EnvConfigSchema.parse(process.env);

main();
async function main() {
  const db = neo4j.driver(config.DATABASE_URL, neo4j.auth.basic(config.DATABASE_USERNAME, config.DATABASE_PASSWORD))
  const [owner, repo] = config.GITHUB_REPOSITORY.split("/");
  const github = new Octokit({
    auth: config.GITHUB_TOKEN,
  })  
  const session = db.session()

  const pullRequest = await createPullRequest(github, owner, repo, session)

  const head = await createCommit(github, owner, repo, session, pullRequest.head.sha)
  const base = await createCommit(github, owner, repo, session, pullRequest.base.sha)
  const tree = await createTree(github, owner, repo, session, head.tree.sha)

  await createDbRelation(session, 'HEAD', {}, pullRequest, head)
  await createDbRelation(session, 'BASE', {}, pullRequest, base)

  console.dir((await createDbRelation(session, 'CONTAINS', {name: '/'}, head, tree, "sha")).summary.query)

  const folder = tree.tree.find(i => i.path === "server");
  const subTree = await createTree(github, owner, repo, session, folder?.sha)

  await createDbRelation(session, 'CONTAINS', {name: folder.path}, tree, subTree, "sha")

  const gitIgnoreFile = tree.tree.find(i => i.path === ".gitignore");
  const blob = await createBlob(github, owner, repo, session, gitIgnoreFile.sha)
  await createDbRelation(session, 'CONTAINS', {name: gitIgnoreFile.path}, tree, blob, "sha")

  await session.close()
  await db.close()
  console.log(Buffer.from(blob.content, "base64").toString());
}

async function createDbRelation(session, type, props, from, to,  key = "node_id", ) {
  z.object({ [key]: z.string() }).parse(from)
  z.object({ [key]: z.string() }).parse(to)


  const dbRelation = await session.run(
    `match (from {${key}:$from.${key}}) match (to {${key}:$to.${key}}) merge (from)-[r:${type} {${Object.keys(props).map(k => `${k}: $props.${k}`).join(", ")}}]->(to) return r`,
    { from, to, props }
  )
  return dbRelation
}

async function createDbEntity(session, type, entity, key = "node_id") {
  z.object({ [key]: z.string() }).parse(entity)


  const dbEntity = await session.run(
    `merge (e:${type} {${key}:$entity.${key}}) on create set e = $entity return e`,
    { entity }
  )

  return dbEntity
}

async function createPullRequest(github, owner, repo, session) {
  const { data: pullRequest } = await github.pulls.get({
    owner,
    repo,
    pull_number: parseInt(config.GITHUB_PR),
  });
  await createDbEntity(session, 'PullRequest', {
    node_id: pullRequest.node_id,
    url: pullRequest.url,
    title: pullRequest.title,
    body: pullRequest.body
  })

  return pullRequest
}

async function createCommit(github, owner, repo, session, sha) {
  const { data: commit } = await github.git.getCommit({
    owner,
    repo,
    commit_sha: sha,
  });
  await createDbEntity(session, 'Commit', {
    node_id: commit.node_id,
    url: commit.url,
    sha: commit.sha,
    message: commit.message
  })

  return commit
}

async function createTree(github, owner, repo, session, sha) {
  const { data: tree } = await github.git.getTree({
    owner,
    repo,
    tree_sha: sha,
  });

  await createDbEntity(session, "Tree", {
    node_id: tree.node_id,
    url: tree.url,
    sha: tree.sha
  }, "sha")

  return tree
}

async function createBlob(github, owner, repo, db, sha) {
  const { data: blob } = await github.git.getBlob({
    owner,
    repo,
    file_sha: sha,
  });
  await createDbEntity(db, 'Blob', {
    node_id: blob.node_id,
    url: blob.url,
    sha: blob.sha
  })

  return blob
}
