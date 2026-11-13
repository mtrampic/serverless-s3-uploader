/*
  Serverless S3 Uploader - per-user authenticated uploads.
  Auth: HTTP Basic against a DynamoDB users table.
  Item shape: { username: S, passwordHash: S }  where
  passwordHash = hex(sha256("<username>:<password>"))
*/

'use strict'

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb')

const s3 = new S3Client({})
const ddb = new DynamoDBClient({})
const BUCKET = process.env.UploadBucket
const TABLE = process.env.UsersTable

const resp = (statusCode, body) => ({
  statusCode,
  headers: { 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
})

// Returns the username on success, null otherwise. Fail closed.
const authenticate = async (event) => {
  try {
    const header = event.headers?.Authorization || event.headers?.authorization
    if (!header || !header.startsWith('Basic ')) return null
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const idx = decoded.indexOf(':')
    if (idx < 1) return null
    const username = decoded.slice(0, idx)
    const password = decoded.slice(idx + 1)
    if (!password) return null

    const result = await ddb.send(new GetItemCommand({
      TableName: TABLE,
      Key: { username: { S: username } }
    }))
    const stored = result.Item?.passwordHash?.S
    if (!stored) return null

    const candidate = crypto.createHash('sha256').update(`${username}:${password}`).digest('hex')
    const a = Buffer.from(stored, 'utf8')
    const b = Buffer.from(candidate, 'utf8')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
    return username
  } catch (err) {
    console.error('auth error', err)
    return null
  }
}

let indexHtml
exports.handler = async (event) => {
  // Public login page - the only unauthenticated route
  if (event.path === '/' && event.httpMethod === 'GET') {
    indexHtml = indexHtml || fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8')
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: indexHtml
    }
  }

  const user = await authenticate(event)
  if (!user) return resp(401, { message: 'Invalid username or password' })

  if (event.path === '/upload-url') {
    const rawName = event.queryStringParameters?.name || 'file'
    const name = rawName.replace(/[^\w.\- ]/g, '_').slice(0, 100)
    const contentType = (event.queryStringParameters?.type || 'application/octet-stream').slice(0, 100)
    const key = `${user}/${Date.now()}-${name}`
    const uploadURL = await getSignedUrl(
      s3,
      new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
      { expiresIn: 900 }
    )
    return resp(200, { uploadURL, key, contentType })
  }

  if (event.path === '/list') {
    const result = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${user}/` }))
    const files = await Promise.all((result.Contents || []).map(async (obj) => ({
      key: obj.Key,
      name: obj.Key.slice(user.length + 1),
      size: obj.Size,
      lastModified: obj.LastModified,
      url: await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }), { expiresIn: 900 })
    })))
    return resp(200, { user, files })
  }

  return resp(404, { message: 'Not found' })
}
