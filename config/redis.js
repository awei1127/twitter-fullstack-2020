// 如果環境名不是production就引入dotenv
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config()
}

const RedisStore = require('connect-redis').default
const redis = require('redis')

const redisClient = redis.createClient({
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
  }
})
redisClient.connect().catch(console.error)

const redisStore = new RedisStore({
  client: redisClient,
  prefix: 'myapp:'
})

module.exports = redisStore
