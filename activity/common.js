//Create Application namespace
Activity = Ember.Application.create({
    LOG_TRANSITIONS: true,
    ready: function() {
        var sockets = {
            trade: io.connect('/trade'),
            stream: io.connect('/stream')
        };
        this.set('sockets', sockets);

        sockets.trade.on('message', function(prices) {
            Activity.Instrument.updatedPrice.set('old', Activity.Instrument.updatedPrice.get('new')||{ sell: 0.00, buy: 0.00 });
            Activity.Instrument.updatedPrice.set('new', prices);
        });

        //Start talking with server
        sockets.trade.send();
    }
});

//Models
Activity.Post = DS.Model.extend({
    post_type: DS.attr('string'),
    user: DS.belongsTo('Activity.User'),
    content: DS.attr('string'),
    date: DS.attr('date'),
    url: DS.attr('string'),
    comments: DS.hasMany('Activity.PostComment'),
    liked: DS.attr('boolean'),
    likes: DS.attr('native'),
    likes_count: DS.attr('number'),
    media: DS.attr('native'),
    show_comments: false,
    show_comment_form: false,
    show_likes_list:false,
    newComment:null,
    media_adapter: function() {
        var media = this.get('media');
        return media;
    }.property('media'),
    is_own: function() {
        return this.get('user.id')==Activity.django_data.user.id;
    }.property('user','Activity.django_data.user'),
    //TODO: find more elegant solution
    likes_printable: function() {
        var likes = this.get('likes');
        var likes_count = this.get('likes_count');

        if(!likes || !likes_count) return {};

        return {
            content: likes ? likes.slice(0, 2).join(', ') : [],
            others: likes_count > 2 ? likes_count - 2 : 0
        };
    }.property('likes.length', 'likes_count'),

    like: function() {
        //TODO: change this quick hack to more "Ember style" solution
        var liked = this.get('liked');
        var url = '/api/activity/posts/' + this.get('id') + '/likes/';

        $.ajax(url, {
                //If post liked - unlike and send "DELETE" request
                type: liked ? 'DELETE' : 'POST',
                dataType: 'json'
        });

        this.toggleProperty('liked');
        if(liked){
            this.decrementProperty('likes_count');
            this.get('likes').removeObject(Activity.django_data.user.username);
        } else {
            this.incrementProperty('likes_count');
            this.get('likes').unshiftObject(Activity.django_data.user.username);
        }
    },
	is_system_post: function() {
      return this.get('post_type') === 'system';
    }.property('post_type')
});

Activity.PostComment = DS.Model.extend({
    post: DS.belongsTo('Activity.Post'),
    user: DS.attr('string'),
    content: DS.attr('string'),
    date: DS.attr('date')
});

Activity.User = DS.Model.extend({
    primaryKey: 'username',

    username: DS.attr('string'),
    first_name: DS.attr('string'),
    last_name: DS.attr('string'),
    date_joined: DS.attr('string'),
    last_login: DS.attr('string'),

    is_following: DS.attr('boolean'),
    following: DS.attr('number'),
    followers: DS.attr('number'),
    avatar:function(){
        //TODO: add avatar feature to profile API
        return "/static/activity/images/none-avatar-50x50.gif";
    }.property(),
    about:function(){
        //TODO: add about feature to profile API
        return "&nbsp;";
    }.property(),
    is_iam:function(){
        return this.get('username')==Activity.django_data.user.id;
    }.property('username')

});

Activity.Instrument = DS.Model.extend({
    primaryKey: 'symbol',

    name: DS.attr('string'),
    symbol: DS.attr('string'),
    asset_class: DS.attr('string'),

    is_favorite: DS.attr('boolean'),
    is_following: DS.attr('boolean'),
    followers: DS.attr('number'),
    starred: DS.attr('number'),
    price: function() {
        var prices_new = Activity.Instrument.updatedPrice.get('new'),
            prices_old = Activity.Instrument.updatedPrice.get('old');

        if(prices_new && prices_new[this.get('symbol')]){
            var np = prices_new[this.get('symbol')];
            np['sell_dir'] = "fixed";
            np['buy_dir'] = "fixed";
            if(prices_old && prices_old[this.get('symbol')]){
                op = prices_old[this.get('symbol')];
                np['sell_dir'] = (np['sell'] - op['sell'])>0?'up':'down';
                np['buy_dir'] = (np['buy'] - op['buy'])>0?'up':'down';
            }
            return np;
        }
        //Default values
        return { sell: 0.00, buy: 0.00, sell_dir:"fixed", buy_dir:"fixed" }
    }.property('Activity.Instrument.updatedPrice.new'),
});

Activity.Instrument.updatedPrice = Ember.Object.create();

Activity.FavoriteInstrument = DS.Model.extend({
    instrument: DS.belongsTo('Activity.Instrument'),
    position: DS.attr('number')
});

Activity.Stream = DS.Model.extend({
    post: DS.belongsTo('Activity.Post'),//Relation by primary key
    reason: DS.attr('native'),
    date: DS.attr('date'),
    // TODO: find more elegant solution
    show_reasons: false,
    reason_printable: function() {
        var reasons = this.get('reason');
        return reasons && reasons.content ? $.map(reasons.content, function(el){ return el.user+" - "+el.action; }).join(', ') : "";
    }.property('reason')
});

//Trade models. It will be used with different namespace
Activity.TradeInstrument = {};
//"Static" which will be observed by socket
Activity.TradeInstrument.updatedPrice = Ember.Object.create();

//Add type for use values from server without any transformations.
DS.RESTAdapter.registerTransform('native', {
    serialize: function(value) {
        return value;
    },
    deserialize: function(value) {
        if( Object.prototype.toString.call( value ) === '[object Array]' ) {
            return Ember.ArrayProxy.create({content: value});
        } else if(typeof value == 'object') {
            return Ember.Object.create(value);
        }

        return value;
    }
});

//Must be filled with api url, because ember-data at this time support only read-only per-model adapters
DS.DjangoRESTAdapter.configure("plurals", {
        "stream": "activity/stream",
        "post": "activity/posts",
        "user": "activity/users",
        "instrument": "activity/instruments",
        "favorite_instrument": "activity/instruments/favorite",

        "post_like": "likes",
        "post_comment": "comments"
    }
);

Activity.Store = DS.Store.extend({
    revision: 12,
    adapter: DS.DjangoRESTAdapter.create({
        namespace: 'api'
    })
});

Activity.Router.reopen({
    location: 'history'/*,
    rootURL: '/activity'*/
});

Activity.Router.map(function () {
    this.route('stream', { path: '/' });

    this.resource('instruments', { path: '/instruments' }, function() {
        this.route('favorite', { path: '/favorite' });
        this.route('detail', { path: '/:symbol' });
    });

    this.resource('users', { path: '/users' }, function() {
        this.route('detail', { path: '/:username' });
    });
});

Ember.SortableView = Em.CollectionView.extend({
  tagName: "tbody",
  change: null,
  disabled: null,
  onDisabled: function() {
      this.$().sortable(
          this.get('disabled') ? 'disable' : 'enable'
      );
  }.observes('disabled'),
  moveItem: function(fromIndex, toIndex){
    var items = this.get('content');
    var item = items.objectAt(fromIndex);

    items.removeAt(fromIndex);
    items.insertAt(toIndex, item);

      var onChangeCallback = this.get('change');
      if(onChangeCallback){
        try{
            onChangeCallback(fromIndex, toIndex, item, items);
        }catch(e) {
            console.log(e);
        }
      }
  },
  didInsertElement: function() {
    var view = this;
    view.$().sortable({
      items : 'tr',
      opacity : 0.6,
      axis : 'y',
      cursor: "move",
      start: function(event, ui) {
        ui.item.previousIndex = ui.item.index();
      },
      stop: function(event, ui) {
        view.moveItem(ui.item.previousIndex, ui.item.index());
      }
    }).disableSelection();

    this.onDisabled();
  },
  willDestroyElement: function() {
    this.$().sortable('destroy');
  }
});

//Patch Ember for loading templates from filesystem
Ember.View.reopen({
    templatesPath: '/static/ember-app/templates/activity',
    templateForName: function (name, type) {
        if (!name) {
            return;
        }

        var templates = Ember.get(this, 'templates'),
            template = Ember.get(templates, name);

        if (!template) {
            $.ajax({
                url: '%@/%@.hbs'.fmt(this.templatesPath, name),
                async: false
            }).success(function (data) {
                    template = Ember.Handlebars.compile(data);
                });
        }

        if (!template) {
            Ember.warn('Template "%@" not found. Instead of it will be used empty template.'.fmt(name), template);
            template = Ember.Handlebars.compile('');
        }

        return Ember.TEMPLATES[name] = template;
    }
});

//if_eq block helper for templates
Handlebars.registerHelper('if_eq', function (v1, v2, options) {
    var context = (options.fn.contexts && options.fn.contexts[0]) || this;
    v1 = Ember.Handlebars.get(context, v1, options.fn) || v1;
    v2 = Ember.Handlebars.get(context, v2, options.fn) || v2;

    if (v1 === v2) {
        return options.fn(this);
    } else {
        return options.inverse(this);
    }
});

// date helper
Ember.Handlebars.registerBoundHelper('date', function(date) {
  return date ? moment(date).fromNow() : '';
});

Activity.registerViewHelper = function(name, view) {
  Ember.Handlebars.registerHelper(name, function(property, options) {
    options.hash.contentBinding = property;
    return Ember.Handlebars.helpers.view.call(this, view, options);
  });
};


Activity.registerViewHelper('linkToMentions', Ember.View.extend({
  tagName: 'span',
  templateName:'stream/_post_content',
  loadedModels:0,
  postParts:(function(){
        var content = this.get('content');
        var cv = this;
        if (content != null) {
            var parts = [],
                pr_offset = 0,
                regex = /[@,#][\w]+/gi;
            content.replace(regex, function(hashtag,offset,s){
                var model,
                    obj,
                    route="";
                parts.push(Ember.Object.create({
                        type:'text',
                        content:s.substr(pr_offset,offset-pr_offset)
                    }));
                switch(hashtag.substr(0,1)){
                    case '#':model='Instrument';route='instruments.detail';break;
                    case '@':model='User';route='users.detail';break;
                    default: model='text';
                }
                if(model!='text'){
                    obj = Activity[model].find(hashtag.substr(1));
                    if(obj.get('isLoaded')){
                        cv.set('loadedModels',cv.get('loadedModels')+1);
                    }else{
                        obj.one('didLoad',function(){
                            if(this.get('isLoaded')){
                                cv.set('loadedModels',cv.get('loadedModels')+1);
                            }
                        });
                    }
                }
                parts.push(Ember.Object.create({
                        type:model,
                        is_model:true,
                        is_ready:obj.get('isLoaded'),
                        is_user:model=='User',
                        content:hashtag,
                        obj:obj
                    }));
                pr_offset=offset+hashtag.length;
            })
            parts.push(Ember.Object.create({
                        type:'text',
                        content:content.substr(pr_offset,content.length-pr_offset)
                    }));
          return parts;
      }
      return [];
  }).property('content'),
  formattedContent: (function() {
    var parts = this.get('postParts');
    if(parts){
        for (var i = parts.length - 1; i >= 0; i--) {
            parts[i].set('is_ready', parts[i].obj&&parts[i].obj.get('isLoaded'));
        };
    }
    return parts;
  }).property('postParts','loadedModels')
}));
