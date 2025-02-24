const { Tweet, User, Reply, Like } = require('../models')
const { Op } = require('sequelize')
const helpers = require('../_helpers')
const dayjs = require('../helpers/dayjs-helper')

const tweetController = {
  // 獲得所有推文
  getTweets: (req, res, next) => {
    const userId = helpers.getUser(req).id
    Promise.all([
      Tweet.findAll({
        // limit: 2,
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'description', 'createdAt'],
        include: [User],
        raw: true,
        nest: true
      }),
      Reply.findAll({
        attributes: ['tweetId'],
        raw: true
      }),
      // 取得包含追蹤者的使用者資料
      User.findAll({
        where: {
          role: 'user',
          id: { [Op.ne]: helpers.getUser(req).id }
        },
        include: [
          { model: User, as: 'Followers' }
        ],
        group: ['User.id'],
        limit: 10
      }),
      User.findByPk(userId, { raw: true }),
      Like.findAll({
        attributes: ['id', 'userId', 'tweetId'],
        raw: true,
        nest: true
      })
    ])
      .then(([tweets, replies, topUsers, currentUser, likes]) => {
        const tweetsData = tweets.map(tweet => ({
          ...tweet,
          replyCount: replies.filter(reply => reply.tweetId === tweet.id).length,
          isLiked: likes.some(like => (like.userId === helpers.getUser(req).id && like.tweetId === tweet.id)),
          likeCount: likes.filter(like => like.tweetId === tweet.id).length
        }))
        // 將目前使用者追蹤的使用者做成一張清單
        const followingList = helpers.getUser(req).Followings.map(f => f.id)
        const data = topUsers
          .map(user => ({
            ...user.toJSON(),
            isFollowed: followingList.includes(user.id),
            followerCount: user.Followers.length
          }))
          // 排序：從追蹤數多的排到少的
          .sort((a, b) => b.followerCount - a.followerCount)
        res.render('tweets', { tweets: tweetsData, topUsers: data, currentUser, isHomePage: true })
      })
      .catch(err => next(err))
  },
  // 新增一則推文
  postTweets: (req, res, next) => {
    const { description } = req.body
    if (!description || description.trim() === '') throw new Error('內容不可空白！')
    if (description.length > 140) throw new Error('字數不可超過140字！')
    Promise.all([
      Tweet.create({ description, UserId: helpers.getUser(req).id })
    ])
      .then(() => {
        req.flash('success_messages', '推文成功！')
        res.redirect('/tweets')
      })
      .catch(err => next(err))
  },
  // 獲取特定推文頁面
  getTweet: (req, res, next) => {
    const tweetId = req.params.id
    Promise.all([
      Tweet.findByPk(tweetId, {
        include: [User],
        raw: true,
        nest: true
      }),
      Reply.findAll({
        include: [User],
        where: { tweetId },
        order: [['createdAt', 'DESC']],
        raw: true,
        nest: true
      }),
      // 取得包含追蹤者的使用者資料
      User.findAll({
        where: {
          role: 'user',
          id: { [Op.ne]: helpers.getUser(req).id }
        },
        include: [
          { model: User, as: 'Followers' }
        ],
        group: ['User.id'],
        limit: 10
      }),
      Like.findAll({
        attributes: ['id', 'userId', 'tweetId'],
        raw: true,
        nest: true
      }),
      // 取得目前登入的使用者資料
      User.findByPk(helpers.getUser(req).id, { raw: true })
    ])
      .then(([tweet, replies, topUsers, likes, currentUser]) => {
        const tweetData = ({
          ...tweet,
          isLiked: likes.some(like => like.userId === helpers.getUser(req).id && like.tweetId === tweet.id),
          likeCount: likes.filter(like => like.tweetId === tweet.id).length
        })
        // 將目前使用者追蹤的使用者做成一張清單
        const followingList = helpers.getUser(req).Followings.map(f => f.id)
        const data = topUsers
          .map(user => ({
            ...user.toJSON(),
            isFollowed: followingList.includes(user.id),
            followerCount: user.Followers.length
          }))
          // 排序：從追蹤數多的排到少的
          .sort((a, b) => b.followerCount - a.followerCount)
        res.render('tweet', { tweet: tweetData, replies, topUsers: data, currentUser })
      })
      .catch(err => next(err))
  },

  // 抓特定推文資料傳給前端
  apiGetTweet: (req, res, next) => {
    const tweetId = req.params.id
    Promise.all([
      Tweet.findByPk(tweetId, {
        include: [User],
        raw: true,
        nest: true
      }),
      User.findByPk(helpers.getUser(req).id, { raw: true })
    ])
      .then(([tweet, currentUser]) => {
        if (!tweet) throw new Error('Tweet did not exist.')
        tweet.fromNow = dayjs(tweet.createdAt).fromNow()
        const result = { tweet, currentUser }
        return res.json(result)
      })
      .catch(err => next(err))
  },
  // 新增回覆
  postReply: (req, res, next) => {
    const { comment } = req.body
    if (!comment || comment.trim() === '') throw new Error('內容不可空白！')
    if (comment.length > 140) throw new Error('字數不可超過140字！')
    const tweetId = req.params.id
    Reply.create({ comment, UserId: helpers.getUser(req).id, tweetId })
      .then(reply => {
        req.flash('success_messages', '回覆成功！')
        res.redirect(`/tweets/${tweetId}/replies`)
      })
      .catch(err => next(err))
  },

  postLike: (req, res, next) => {
    const tweetId = req.params.id
    return Promise.all([
      Tweet.findByPk(tweetId),
      Like.findOne({
        where: {
          UserId: helpers.getUser(req).id,
          TweetId: tweetId
        }
      })
    ])
      .then(([tweet, like]) => {
        if (!tweet) throw new Error("Tweet doesn't exist!")
        if (like) throw new Error('You have liked this!')
        return Like.create({
          UserId: helpers.getUser(req).id,
          TweetId: tweetId
        })
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  },

  postUnlike: (req, res, next) => {
    const tweetId = req.params.id

    return Like.findOne({
      where: {
        UserId: helpers.getUser(req).id,
        TweetId: tweetId
      }
    })
      .then(like => {
        if (!like) throw new Error("You haven't liked this!")
        return like.destroy()
      })
      .then(() => res.redirect('back'))
      .catch(err => next(err))
  }
}

module.exports = tweetController
