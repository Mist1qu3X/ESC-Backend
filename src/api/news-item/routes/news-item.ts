'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/news-items',
      handler: 'news-item.find',
      config: { policies: [] }
    },
    {
      method: 'GET',
      path: '/news-items/:id',
      handler: 'news-item.findOne',
      config: { policies: [] }
    }
  ]
};