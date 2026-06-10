'use strict';

module.exports = {
  async find(ctx) {
    return await strapi.entityService.findMany('api::spotlight-item.spotlight-item', ctx.query);
  },
  async findOne(ctx) {
    const { id } = ctx.params;
    return await strapi.entityService.findOne('api::spotlight-item.spotlight-item', id, ctx.query);
  }
};