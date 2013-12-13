Activity.ApplicationController = Ember.Controller.extend({
    needs: 'stream',

    django_data: function() {
        Activity.django_data.user = Activity.User.find(
            Activity.django_data.user.username
        );
        return Activity.django_data;
    }.property(),

    postContent: null,
    addPostPopUp: function() {
        Bootstrap.ModalPane.popup({
            classNames: 'modal add-post',
            heading: "Post an update",
            message: "<textarea placeholder=\"Type message\" name=\"post-content\"></textarea>",
            primary: "Add",
            secondary: "Cancel",
            showBackdrop: true,
            callback: function(opts, event) {
                if (opts.primary) {
                    var postData = {
                        content: this.$().find('textarea').val(),
                        date: new Date()
                    };
                    if(!postData.content) {
                        this.set('helpMessage', '<span style="color: red;">Please fill post content</span>');
                        return false;
                    } else {
                        var post = Activity.Post.createRecord(postData);
                        post.get('store').commit();
                    }
                    // primary button was pressed
                } else if (opts.secondary) {
//                    console.log(this.$().find('textarea').val(), controller);
                    // secondary button was pressed
                } else {
                    // close was pressed
                }
            }
        });
    }
});

Activity.ApplicationView = Ember.View.extend({
    templateName: "main"
});

Activity.PostMixin = Ember.Mixin.create({
    like: function(post) {
        post.like();
    },
    toggle_comments: function(post) {
        post.toggleProperty('show_comments');
        post.set('show_comment_form', post.get('show_comments'));
    },
    toggle_comment_form: function(post) {
        if(!post.get('show_comments')){
            post.toggleProperty('show_comment_form');
        }
    },
    add_comment: function(post) {
        (function(p) {
            var comment = {
                content: p.get('newComment').trim(),
                date: new Date()
            };

            if (comment.content) {
                p.set('newComment', '');
                p.set('show_comment_form', false);

                var newComment = p.get('comments').createRecord(comment);
                newComment.get('store').commit();
            }
        })(post);
    },
    toggle_like_list: function(post) {
        post.toggleProperty('show_likes_list');
    },
    toggle_reason_list: function(item) {
        item.toggleProperty('show_reasons');
    },
    content: []
});

Activity.StreamRoute = Ember.Route.extend({
    socketConnected: false,
    deactivate: function(event){
        //Disconnect from socket when this route leaved
        //Doesn't work
        //Activity.sockets.stream.disconnect();
    },
    setupController: function(controller, model) {
        var route = this;
        if(!this.get('socketConnected')) {
            var socket = Activity.sockets.stream;
            socket.on('message', function(data) {
                data = JSON.parse(data);
                if(data.length){
                    //Iterate over received items and add it to store and streamIndexController
                    data.forEach(function(item) {
                        var items = controller.filterProperty('id', String(item.id));
                        if(items.length){
                            items.forEach(function(cItem) {
                                cItem.set('date', DS.JSONTransforms.date.deserialize(item.date));
                            });
                        } else {
                            var store = Activity.Stream.all().get('store');
                            //Load record to store
                            store.adapterForType(Activity.Stream).load(
                                store,
                                Activity.Stream,
                                item
                            );

                            var storeItem = Activity.Stream.find(item.id);
                            storeItem.addObserver('post.post_type', controller, controller.selectedFilterObserver);
                            controller.get('content').unshiftObject(storeItem);
                        }
                    });
                }
            });

            socket.on('connect', function() {
                route.set('socketConnected', true);
            });
            socket.on('disconnect', function() {
                route.set('socketConnected', false);
            });

            var interval = setInterval(function() {
                //Send packet to server for listen on new records
                if(model.isLoaded) {
                    socket.send();
                }
                clearInterval(interval);
            }, 1000);
        }

        controller.set('content', model);
    },
    model: function() {
        return Activity.Stream.find({});
    }
});

Activity.StreamController = Ember.ArrayController.extend(Activity.PostMixin, {
    sortProperties: ['date'],
    sortAscending: false,
    filters: [
        'All',
        'Posts',
        'Activity'
    ],
    selectedFilter: 'All',
    selectedFilterObserver: function() {
        var filter = this.get('selectedFilter');
        var content = this.get('arrangedContent');

        if(filter == 'All') {
            this.set('filteredContent', content);
        }
        else if (filter == 'Posts') {
            this.set('filteredContent', content.filterProperty('post.post_type', 'user'));

        } else if (filter == 'Activity') {
            this.set('filteredContent', content.filter(function(item) {
                return item.get('reason.length');
            }));
        }
    }.observes('selectedFilter', 'arrangedContent.length'),

    filterPosts: function(kind) {
        var content = this.get('arrangedContent');

        if(!kind) this.set('filteredContent', content);
        else if (kind == 'posts') {
            this.set('filteredContent', content.filterProperty('post.post_type', 'user'));
        } else if (kind == 'activity') {
            this.set('filteredContent', content.filter(function(item) {
                return !!item.reason.length;
            }));
        }
    },
    filteredContent: function() {
        return this.get('arrangedContent');
    }.property('arrangedContent.length'),
    hidePost: function(item) {
        //TODO: maybe it is sense to make posts deleting throw socetIO
        if(!confirm("Are you realy want to "+(item.get('post.is_own')?'delete':'hide')+" this post?")){
            return;
        }
        this.get('content').removeObject(item);
        if(item.get('post.is_own')){
            item.get('post').deleteRecord();
        }else{
            item.deleteRecord();
        }
        this.get('store').commit();
    }
});

Activity.StreamView = Ember.View.extend({
    templateName: 'stream/index'
});

Activity.MiniProfileMixin = Ember.Mixin.create({
    renderTemplate: function() {
        // Render default outlet
        this.render();
        // render extra outlets
        this.render(this.get('profileTemplate'), {
            outlet: "top-tip",
            into: "application" // important when using at root level
        });
    }
});

Activity.FollowMixin = Ember.Mixin.create({
    follow: function(item) {
        item.toggleProperty('is_following');
        item.get('store').commit();
    }
});

//Users and instruments

Activity.UsersDetailRoute = Ember.Route.extend(Activity.MiniProfileMixin, {
    profileTemplate: "userMiniProfile",
    serialize: function(obj){
        if(!obj) return { username: '' };

        return { username: obj.get('username') }
    },
    setupController: function(controller, model) {
        this._super();
        controller.set('posts', Activity.Post.find({
            user: model.get('username')
        }));
    },
    model: function(params) {
        return Activity.User.find(params.username);
    }
});

Activity.UsersDetailController = Ember.ObjectController.extend(Activity.PostMixin,Activity.FollowMixin, {
    deletePost: function(post) {
        if(!confirm("Are you realy want to delete this post?")){
            return;
        }
        this.get('content.posts').removeObject(post);
        post.deleteRecord();
        this.get('store').commit();
    }
});

Activity.UserMiniProfileView = Ember.View.extend({
    templateName: "users/mini_profile"
});

Activity.UsersDetailView = Ember.View.extend({
    templateName: "instruments/detail"
});

Activity.InstrumentsDetailRoute = Ember.Route.extend(Activity.MiniProfileMixin, {
    profileTemplate: "instrumentMiniProfile",
    serialize: function(obj){
        return { symbol: obj.get('symbol') }
    },
    setupController: function(controller, model) {
        this._super();
        controller.set('posts', Activity.Post.find({
            instrument: model.get('symbol')
        }));
    },
    model: function(params) {
        return Activity.Instrument.find(params.symbol);
    }
});

Activity.InstrumentsDetailController = Ember.ObjectController.extend(Activity.PostMixin, Activity.FollowMixin);

Activity.InstrumentMiniProfileView = Ember.View.extend({
    templateName: "instruments/mini_profile"
});

Activity.InstrumentsDetailView = Ember.View.extend({
    templateName: "instruments/detail"
});

Activity.UsersIndexRoute = Ember.Route.extend({
    model: function() {
        return Activity.User.find({followable: true});
    }
});

Activity.UsersIndexController = Ember.ArrayController.extend(Activity.FollowMixin, {
    content: []
});

Activity.UsersIndexView = Ember.View.extend({
    templateName: 'users/list'
});

Activity.InstrumentMixin = Ember.Mixin.create({
    asset_classes:[
        'all',
        'Currency',
        'Commodity',
        'EquityIndex',
        'Stock'
    ],
    selected_asset_class: 'all',
    content: [],
    filteredContent: function() {
        return this.get('content');
    }.property('content.@each'),

    favorite: function(item) {
        item.toggleProperty('is_favorite');
        item.get('store').commit();
    }
});

Activity.InstrumentsIndexController = Ember.ArrayController.extend(Activity.InstrumentMixin, Activity.FollowMixin, {
    asset_classChanged: function() {
        var asset_class = this.get('selected_asset_class');
        if(asset_class){
            var content = this.get('content');
            if(asset_class == 'all'){
                this.set('filteredContent', content);
            } else {
                this.set(
                    'filteredContent',
                    content.filterProperty('asset_class', asset_class)
                );
            }
        }
    }.observes('selected_asset_class')
});

Activity.InstrumentsIndexRoute = Ember.Route.extend({
    setupController: function(controller, model) {
        controller.set(
            'content',
            model
        );
    },
    model: function(){
        return Activity.Instrument.find({});
    }
});

Activity.InstrumentsIndexView = Ember.View.extend({
    templateName: "instruments/list"
});

Activity.InstrumentsFavoriteController = Ember.ArrayController.extend(Activity.InstrumentMixin, Activity.FollowMixin, {
    //Resort favorites on any change
    asset_classChanged: function() {
        var asset_class = this.get('selected_asset_class');
        if(asset_class){
            var content = this.get('content');
            if(asset_class == 'all'){
                this.set('filteredContent', content);
                this.set('sortDisabled', false);
            } else {
                this.set(
                    'filteredContent',
                    content.filterProperty('instrument.asset_class', asset_class)
                );
                this.set('sortDisabled', true);
            }
        }
    }.observes(
            'selected_asset_class'
        ),
    sortDisabled: false,
    //Send new position on server
    positionChanged: function(fromIndex, toIndex, item, items) {
        item.set('position', toIndex + 1);
        item.get('store').commit();
    },
    favorite: function (item) {
        item.toggleProperty('instrument.is_favorite');
        item.get('store').commit();

        this.get('content').removeObject(item);
    }
});

Activity.InstrumentsFavoriteRoute = Ember.Route.extend({
    setupController: function(controller, model) {
        controller.set(
            'content',
            model
        );
    },
    model: function() {
        return Activity.FavoriteInstrument.find({});
    }
});

Activity.InstrumentsFavoriteView = Ember.View.extend({
    templateName: "instruments/favorites"
});

