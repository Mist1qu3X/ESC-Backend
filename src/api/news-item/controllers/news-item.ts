'use strict';

module.exports = {
  async find(ctx) {
    return await strapi.entityService.findMany('api::news-item.news-item', ctx.query);
  },
  async findOne(ctx) {
    const { id } = ctx.params;
    return await strapi.entityService.findOne('api::news-item.news-item', id, ctx.query);
  }
};