require('dotenv').config()

const { createAudioResource, AudioPlayerStatus } = require('@discordjs/voice');
const playDL = require('play-dl');
const { getLyrics } = require('genius-lyrics-api');

const { connect } = require('./connect')
const { queue, addSong } = require('./queue')
const { parse, getRandomInt, splitText } = require('./utils');


/**
 * Processes user input to either search for a song or a URL.
 * @param {Message} message A Discord message object.
 * @param {Object} serverQueue Contains information related to a Discord server's queue.
 * @returns {Message} A message to the channel based on the user input.
 */
async function validateRequest(message) {
    const serverQueue = queue.get(message.guild.id);

    //check the last argument to see if it is a valid time to seek to
    //let timeToSeek = parse(args[args.length-1]);

    let request = message.content; //no trim or arguments will stop working due to regex needing whitespace
    //console.log(request);

    const attachment = message.attachments?.first() ?? 0; //if attachment does not exist, assign 0 instead
    const voiceChannel = message.member.voice.channel;
    //const attachedUrl = message.attachments?.first()?.url ?? 0;
    // if (!voiceChannel){
    //     return (Math.round(Math.random())) ? message.channel.send("❌ You need to be in a channel to play music.") : message.channel.send("how bout u hop in a voice channel first❓");
    //    //return message.channel.send("You need to be in a channel to play music.");
    // }

    if (!request && !attachment) {//someone invokes play command without any arguments
        return message.channel.send("❌ Specify a search, URL, or mp3 to play 🤓")
    }

    if (attachment) request = attachment.url; //if we dont assign args[1] to url, args[1].trim will fail
    try {
        let song = {};  //object containing song data
        let songs = []; //array of song objects
        //let check = await playDL.validate(args[1].trim());
        let check = await playDL.validate(request);
        let searchSource = { youtube: 'video' };  //where we want to perform the search and what type of result
        let searchMsg = '';
        //console.log(check)  //debug
        if (check === false) {
            song = {
                title: attachment.name, //?? args[1].slice(args[1].lastIndexOf('/')+1),
                url: attachment.url, //?? args[1],
                source: 'discord'
            }
            songs.push(song);
        } else if (check === 'search') {
            let prefix = '';
            let suffix = '';
            let argsRegex = new RegExp(/\s-[^\s]+/, 'g');
            let options = request.match(argsRegex) ?? [];
            options = options.map(e => e.trim());
            request = request.replace(argsRegex, "").trim();
            if (options.includes('-sc') || options.includes('-soundcloud')) {
                searchSource = { soundcloud: 'tracks' };
                if (options.includes('-pl') || options.includes('-playlist')) {
                    searchSource = { soundcloud: 'playlists' }
                    prefix = 'a playlist '
                } else if (options.includes('-al') || options.includes('-album')) {
                    searchSource = { soundcloud: 'albums' }
                    prefix = 'an album '
                }
                suffix = ' on SoundCloud'
            } else if (options.includes('-pl') || options.includes('-playlist')) {
                searchSource = { youtube: 'playlist' }
                prefix = 'a playlist '
                suffix = ' on YouTube'
            }
            searchMsg = await message.channel.send(`Searching for ${prefix}"${request}"${suffix} 🔎`);
            console.log(`${message.author.username} searched for ${prefix}"${request}"${suffix} 🔎`);
            //let request = message.content.substring(message.content.indexOf(' '),timeToSeek ? message.content.lastIndexOf(' ') : message.content.length).trim(); //if timetoseek is non-zero, go to last space (omit seek time) otherwise accept whole message
            const search = await playDL.search(request, {
                limit: 1,
                source: searchSource
            })
            searchMsg.delete();
            //console.log(search)
            //console.log(searchSource);
            if (search.length == 0) {
                return message.channel.send(`❌ No results found for  '${request}'  😢`);
            } else {
                if (search[0].type == 'track' || search[0].type == 'video') {
                    song = {
                        title: search[0].title || search[0].name,
                        url: search[0].url,
                        duration: search[0].durationInSec,
                        seek: 0,    //amount of time to seek to in the song in seconds
                        source: 'youtube' in searchSource ? 'yt' : 'sc'
                    }
                    //console.log(song);
                    //console.log(song.url)
                    songs.push(song);
                } else if (search[0].type == 'playlist') {
                    message.content = search[0].url;
                    return validateRequest(message, serverQueue);
                } else {
                    console.log(search[0]);
                    return console.error("Failed to find a valid search.");
                }

            }
        } else {
            let [source, type] = check.split("_");
            //console.log(type);  //debug
            if (source === 'yt') {
                if (type === 'video') {
                    const video = await playDL.video_info(request);
                    song = {
                        title: video.video_details.title,
                        url: video.video_details.url,
                        duration: video.video_details.durationInSec,
                        seek: 0,
                        source: 'yt'
                    }
                    songs.push(song)
                } else if (type === 'playlist') {
                    const playlist = await playDL.playlist_info(request, { incomplete: true }) //parse youtube playlist ignoring hidden videos
                    const videos = await playlist.all_videos()
                    console.log(`Fetched ${playlist.total_videos} videos from "${playlist.title}"`)
                    videos.forEach(function (video) {
                        song = {
                            title: video.title,
                            url: video.url,
                            duration: video.durationInSec,
                            seek: 0,
                            source: 'yt'
                        }
                        songs.push(song)
                    })
                    message.channel.send(`Added \*\*${songs.length}\*\* songs to the queue.`)
                }
            } else if (source === 'so') {
                const so = await playDL.soundcloud(request)
                if (type === 'track') {
                    song = {
                        title: so.name,
                        url: so.url,
                        duration: so.durationInSec,
                        source: 'so'
                    }
                    songs.push(song)
                } else if (type === 'playlist') {
                    const tracks = await so.all_tracks()
                    console.log(`Fetched ${so.total_tracks} tracks from "${so.name}"`)
                    tracks.forEach(function (track) {
                        song = {
                            title: track.name,
                            url: track.url,
                            duration: track.durationInSec,
                            source: 'so'
                        }
                        songs.push(song)
                    })
                    message.channel.send(`Added \*\*${songs.length}\*\* songs to the queue.`)
                }
            } else if (source === 'sp') {
                //await getSpotifyToken(spotifyId,spotifySecret)
                if (playDL.is_expired()) {
                    await playDL.refreshToken();
                    console.log('Refreshed Spotify token.')
                }
                //return message.channel.send("Spotify is currently not supported. Refer to https://play-dl.github.io/modules.html#stream for more information.")
                const spot = await playDL.spotify(request)
                const searchRequests = [];
                //console.log(type);
                if (type === 'track') {
                    searchRequests.push(`${spot.name} ${spot.artists[0].name}`)
                } else if (type === 'album' || type === 'playlist') {
                    const tracks = await spot.all_tracks();
                    const loadingMsg = await message.channel.send(`📇 Loading...`);
                    tracks.forEach((track) => searchRequests.push(`${track.name}  ${track.artists[0].name}`))
                    loadingMsg.delete();
                    console.log(`Fetched ${songs.length} videos from "${tracks.name}"`)
                }
                await Promise.all(searchRequests.forEach(async (track) => { //fast but album is shuffled
                    const search = await playDL.search(track, {
                        limit: 1,
                        source: searchSource
                    })
                    if (search.length == 0) return;
                    song = {
                        title: search[0].title,
                        url: search[0].url,
                        duration: search[0].durationInSec,
                        seek: 0,
                        source: 'yt'
                    }
                    songs.push(song);
                }));
                message.channel.send(`Added \*\*${songs.length}\*\* songs to the queue.`)
            }
        }

        //console.log(song);
        // if(song.source === 'yt'){
        //     let maxDuration = song.duration;
        //     if (timeToSeek > maxDuration){ 
        //         //console.log(maxDuration)
        //         let maxTime = parse(maxDuration);
        //         console.log(`Seek exceeded song limits, requested ${timeToSeek}, max is ${maxDuration}`);
        //         return message.channel.send(`❌ Seeking beyond limits. <0-${maxTime.minutes}:${maxTime.seconds}>`);
        //     }
        // }
        //console.log(serverQueue);
        if (!serverQueue) { //if there is no existing server queue, 
            connect(message, songs); //connect to the server,
            play(message, songs[0]); //and play the requested song
            return;
        }
        if (serverQueue.songs.length == 0) {   //if queue already exists but is empty
            serverQueue.songs = serverQueue.songs.concat(songs);    //append the new songs to the end of the queue, done after the length is checked 
            play(message, serverQueue.songs[0]);
            return;
        }

        //if the queue is not empty, and the bot is not paused
        if (serverQueue.player.state.status != AudioPlayerStatus.Paused) {
            addSong(message, songs)
            return;
        }

        //if the bot is paused, replace the current song with the requested song
        if (process.env.REPLACE_WHILE_PAUSED) {
            serverQueue.songs.splice(1, 0, songs[0]);      //make it the next song
            resume(message);
            serverQueue.player.stop();
            return;
        }

        //otherwise prompt the user if they want to resume their current song, or replace it
        const pauseMsg = await message.channel.send(`The bot is paused. The current song is \`\`${serverQueue.songs[0].title}\`\`.\n\*\*Do you want to play \`\`${songs[0].title}\`\` instead?\*\*`);

        pauseMsg.react('❌');
        pauseMsg.react('✅');

        const collectorFilter = (reaction, user) => {
            return ['❌', '✅'].includes(reaction.emoji.name) && user.id === message.author.id;
        };
        pauseMsg.awaitReactions({ filter: collectorFilter, max: 1, time: 30_000, errors: ['time'] })
            .then(collected => {
                if (collected.first().emoji.name == '✅') {
                    serverQueue.songs.splice(1, 0, songs[0]);      //make it the next song
                    serverQueue.player.stop();
                } else {
                    message.channel.send(`Unpausing now...`).then(msg => setTimeout(() => msg.delete(), 1_000));
                    addSong(message, songs)
                }
                setTimeout(() => resume(message, serverQueue), 1_000);
            }).catch(() => {
                //pauseMsg.reply('No reaction after 30 seconds, operation canceled');
            }).finally(() => {
                pauseMsg.delete();
            });
    } catch (e) {
        console.error(e);
        return message.channel.send(`\`Error looking for song: ${e.message}\``);
    }
}


/**
 * Plays a song.
 * @param {Message} message A Discord message object.
 * @param {Object} song Contains information about a song.
 * @returns {Message} A message to the channel on the state of the song (playing, searching)
 */
async function play(message, song) {
    const serverQueue = queue.get(message.guild.id);

    if (!song) {
        //     serverQueue.timeoutID = setTimeout(() => {  //separate timeout for each server
        //         //clearInterval(userCheck);
        //         if (getVoiceConnection(guild.id) != undefined) {
        //             //console.log(getVoiceConnection(guild.id));
        //             console.log(`Timeout for "${guild.name}"`);
        //             destroy(guild);
        //             serverQueue.timeoutID = undefined;  //after timeout goes off, reset timeout value.
        //         } else {
        //             console.log("Bot was disconnected during the timeout.");
        //         }
        //     }, 10 * 60 * 1000); //10 min idle
        //     console.log(`Timeout set for "${guild.name}"`);
        //     if (serverQueue.loop == true){
        //         serverQueue.loop = false;   //if there is no song to be played, disable the loop, no point looping an empty queue
        //         console.log('Disabled the loop.');
        //     }
        if (serverQueue.autoplay && serverQueue.lastPlayed) {
            message.content = await getRelatedSong(serverQueue.lastPlayed);
            validateRequest(message);
        }
        return;
    }

    //if song is queued during timeout, clear timeout
    // if (serverQueue.timeoutID != undefined){    
    //     console.log(`Timeout cleared for "${guild.name}"`);
    //     clearTimeout(serverQueue.timeoutID);
    //     serverQueue.timeoutID = undefined;
    // } 

    let stream = {
        stream: null
    };
    //console.log(song.source);

    try {
        if (song.source == 'yt' && song.seek > 0) {  //only yt songs can be seeked, but there are songs from various sources in the playlist
            //console.log(`Seeked ${song.seek} seconds into ${song.title}.`);
            stream = await playDL.stream(song.url, { seek: song.seek });
        } else if (song.source == 'discord') {
            stream.stream = song.url;
        } else {
            stream = await playDL.stream(song.url);
        }
        serverQueue.resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true
        });
    } catch (e) {
        serverQueue.songs.splice(0,1); //remove the song from the queue 
        console.error(e);
        return message.channel.send(`\`❌ Something went wrong trying to play ${song.title}, please try a different song.\``);
    }

    //Sets the volume relative to the input stream - i.e. 1 is normal, 0.5 is half, 2 is double.
    serverQueue.resource.volume.setVolume(serverQueue.volume / 100);

    serverQueue.connection.subscribe(serverQueue.player);
    serverQueue.player.play(serverQueue.resource);
    serverQueue.lastPlayed = song;

    serverQueue.player.once(AudioPlayerStatus.Idle, () => {
        if (serverQueue.loop && serverQueue.keep) {    //the loop is on and the song is flagged to be kept
            serverQueue.songs.push(serverQueue.songs.shift());
        } else {
            //pop song off the array (placing the next song at the top)
            serverQueue.songs.shift();
            if (serverQueue.loop === true) {
                serverQueue.keep = true;    //reset keep flag after skipping in a loop
            }
        }
        play(message, serverQueue.songs[0]);
    })

    if (serverQueue.loop || serverQueue.autoplay) {
        console.log(`Playing ${song.title} {${song.durationTime.minutes}:${song.durationTime.seconds}} in "${message.guild.name}"`)
        // don't print anything
    } else {
        let durationTime = parse(song.duration)
        if (song.source == 'discord') {
            console.log(`Playing ${song.title} in "${message.guild.name}"`)
            message.channel.send(`🎶 Now playing \*\*${song.title}\*\* 🎵`);
        } else if (song.seek > 0) {
            let seekTime = parse(song.seek)
            console.log(`Playing ${song.title} {${durationTime.minutes}:${durationTime.seconds}} in "${message.guild.name}" starting at {${seekTime.minutes}:${seekTime.seconds}}`);
            message.channel.send(`🎶 Now playing [${song.title}](<${song.url}>) \`${durationTime.minutes}:${durationTime.seconds}\` starting at \`${seekTime.minutes}:${seekTime.seconds}\` 🎵`)
            //.then(msg => setTimeout(() => msg.delete(), song.duration*1000));
        } else {
            console.log(`Playing ${song.title} {${durationTime.minutes}:${durationTime.seconds}} in "${message.guild.name}"`) //starting at {${song.seekTime.minutes}:${song.seekTime.seconds}}`);
            message.channel.send(`🎶 Now playing [${song.title}](<${song.url}>) \`${durationTime.minutes}:${durationTime.seconds}\` 🎵`)
            //.then(msg => setTimeout(() => msg.delete(), song.duration*1000));
        }
    }
}

/**
 * Plays related songs from YouTube.
 * @param {Message} message A Discord message object.
 * @returns {Message} A message indicating if autoplay is on or not.
 */
async function autoplay(message) {
    const serverQueue = queue.get(message.guild.id);
    const args = message.content.split(' ');
    if (!serverQueue || !serverQueue.lastPlayed) {
        return message.channel.send("❌ No data to find related songs. (Play a song first)");
    }
    if (args.length > 1 && args.includes('off')) {
        serverQueue.autoplay = false;
        console.log(`Autoplay disabled in "${message.guild.name}".`)
        return message.channel.send(`Autoplay disabled.`)
    }
    serverQueue.autoplay = !serverQueue.autoplay
    if (serverQueue.autoplay) {
        if (serverQueue.lastPlayed && serverQueue.songs.length == 0) {
            message.content = await getRelatedSong(serverQueue.lastPlayed);
            validateRequest(message);
        }
        console.log(`Playing songs related to ${serverQueue.lastPlayed.title}`)
        return message.channel.send(`💿 Now playing songs related to \*\*${serverQueue.lastPlayed.title}\*\* 💿`)
    }
    console.log(`Autoplay disabled in "${message.guild.name}".`)
    return message.channel.send(`Autoplay disabled.`)
}

/**
 * Finds a related song shorter than a specified duration
 * @param {Object} song Object containing song data
 * @returns {Promise<string>} A Youtube URL
 */
async function getRelatedSong(song, duration = 500) {
    if (song.source !== 'yt') {
        return message.channel.send("❌ Song must be from YouTube to find related songs.");
    }
    const songs = (await playDL.video_basic_info(song.url)).related_videos;
    for (let url of songs) {
        let data = (await playDL.video_basic_info(url)).video_details;
        if (data.durationInSec < duration) {
            return data.url;
        }
    }
    return songs[0];
}

/**
 * Pauses the song.
 * @param {Message} message A Discord message object.
 * @returns {Message} A message showing if the song has been paused or not.
 */
function pause(message) {
    const serverQueue = queue.get(message.guild.id);

    if (!serverQueue || serverQueue.songs.length == 0) {
        return message.channel.send("❌ No song to pause.");
    }
    if (serverQueue.player.pause()) {
        console.log(`Song paused.`);
        return message.channel.send("⏸️ Paused song. (type !resume to continue playing)")
    }
    console.log("Failed to pause.")
    return message.channel.send("❌ Something went wrong pausing the bot.")
}

/**
 * Resumes the song.
 * @param {Message} message A Discord message object.
 */
function resume(message) {
    const serverQueue = queue.get(message.guild.id);

    if (!serverQueue || serverQueue.songs.length == 0) {
        return message.channel.send("❌ No song to resume.");
    }
    if (serverQueue.player.unpause()) {
        console.log(`Song resumed.`);
        return;
        //return message.channel.send("▶️ Resumed song.")
    }
    return message.channel.send("❌ Something went wrong unpausing the bot.")
}

/**
 * Replays the last played song.
 * @param {Message} message A Discord message object.
 * @returns 
 */
function replay(message) {
    const serverQueue = queue.get(message.guild.id);

    if (!serverQueue || !serverQueue.lastPlayed) {
        return message.channel.send("❌ No song to replay. (Play a song before trying to replay it)");
    }
    serverQueue.songs.splice(0, 1, serverQueue.lastPlayed) //add song to queue
    play(message, serverQueue.songs[0]);
}


/**
 * Seek to a desired time in a song.
 * @param {Message} message A Discord message object.
 * @param {number} [time=0] Number of seconds to seek into the song.
 * @returns 
 */
function seek(message, time = -1) {
    const serverQueue = queue.get(message.guild.id);

    const args = message.content.split(" ");
    if (!serverQueue || serverQueue.songs.length == 0) {
        return message.channel.send("❌ No song to seek.");
    }
    if (serverQueue.songs[0].source !== 'yt') {
        return message.channel.send("❌ Song must be from YouTube to seek.");
    }
    if (['minutes', 'minute', 'm'].includes(args[2])) {
        args[1] = `${args[1]}:00`;
    }
    //console.log(serverQueue.resource.playbackDuration);
    let timeToSeek = 0;
    if (time == -1) { //if no timestamp is given then process the user's timestamp
        timeToSeek = parse(args[1]) || parse(time);
        let maxDuration = serverQueue.songs[0].duration;
        let maxTime = parse(maxDuration);
        if (args[1].indexOf(':') == -1) {
            return message.channel.send(`❌ Enter a timestamp between <0:00-${maxTime.minutes}:${maxTime.seconds}>`);
        }
        if (timeToSeek > maxDuration || timeToSeek < 0) {
            //console.log(maxDuration)
            console.error(`Seek failed, requested ${timeToSeek}, max is ${maxDuration}`);
            return message.channel.send(`❌ Enter a timestamp between <0:00-${maxTime.minutes}:${maxTime.seconds}>`);
        }
    }
    //else if (timeToSeek == 0) {
    //     return message.channel.send(`❌ Specify a timestamp. <0-${maxTime.minutes}:${maxTime.seconds}>`);
    // }
    let currentSong = serverQueue.songs[0];
    currentSong.seek = timeToSeek || time; //used to seek in the song

    //serverQueue.songs.unshift(currentSong);
    serverQueue.songs.splice(1, 0, currentSong);
    serverQueue.player.stop();
}

/**
 * Fast forward a set amount of time in a song.
 * @param {Message} message A Discord message object.
 * @returns {Message} A message indicating where the song has been forwarded to.
 */
function forward(message) {
    const serverQueue = queue.get(message.guild.id);

    const args = message.content.split(" ");
    if (!serverQueue || serverQueue.songs.length == 0) {
        return message.channel.send("❌ No song to forward.");
    }
    if (serverQueue.songs[0].source != 'yt') {
        return message.channel.send("❌ Song must be from YouTube to forward.");
    }
    let song = serverQueue.songs[0];
    let amountToForward = parseInt(parse(args[1]) || args[1]) || 30;

    let currentTime = Math.floor((serverQueue.resource.playbackDuration + (song.seek * 1000)) / 1000); //convert to seconds
    let newTime = Math.max(0, currentTime + amountToForward);

    let displayStartTime = parse(currentTime);
    let displayEndTime = parse(Math.min(newTime, song.duration));
    //console.log(amountToForward);
    //console.log(displayStartTime);
    //console.log(displayEndTime);

    console.log(`Forwarded ${amountToForward} seconds in ${song.title} from ${displayStartTime.minutes}:${displayStartTime.seconds} to ${displayEndTime.minutes}:${displayEndTime.seconds}`);
    const ffMsg = message.channel.send(`Forwarded \*\*${song.title}\*\* from \`${displayStartTime.minutes}:${displayStartTime.seconds}\` to \`${displayEndTime.minutes}:${displayEndTime.seconds}\`.`);
    if (newTime > song.duration) {
        return serverQueue.player.stop(); //just skip the song if they forward too far
    }
    seek(message, serverQueue, newTime);
    //ffMsg.delete();
}

/**
 * Change the volume of the song.
 * @param {Message} message A Discord message object.
 * @returns {Message} A message indicating what the volume has been changed to.
 */
function volume(message) {
    const serverQueue = queue.get(message.guild.id);

    if (!serverQueue) {
        return message.channel.send("❌ Play a song to change its volume.");
    }
    let [min, max] = [0, 500];
    const args = message.content.split(" ");
    let vol = parseInt(args[1])
    if (vol < min || vol > max || isNaN(vol)) {
        return message.channel.send(`❌ Volume must be 0% to 500%.`)
    }
    //serverQueue.volume = vol;
    serverQueue.resource.volume.setVolume(vol / 100);
    console.log(`Set volume for ${serverQueue.songs[0].title} to ${vol}`);
    return message.channel.send(`🔊 Volume has been set to \`${vol}%\` for \*\*${serverQueue.songs[0].title}\*\*`);
}

/**
 * Displays lyrics for the current playing song.
 * @param {Message} message A Discord message object.
 * @returns {Message} A message containing lyrics of the current song.
 */
async function lyrics(message, key){
    const serverQueue = queue.get(message.guild.id);

    if (!serverQueue || serverQueue.songs.length == 0) {
        return message.channel.send("❌ No song to get lyrics for.");
    }
    const {title, duration, artist} = serverQueue.songs[0];
    const options = {
        apiKey: key,
        title: title,
        artist: ' ',
        optimizeQuery: true
    };
    console.log(`Finding lyrics for ${options.title}`);
    const searchMsg = await message.channel.send(`Finding lyrics for \*\*${title}\*\* 🔎`);
    getLyrics(options)
            .then((lyrics) => { 
                let song = serverQueue.songs[0];
                searchMsg.delete();
                if (!lyrics) { 
                    console.log(`No lyrics found.`);
                    return message.channel.send(`❌ No lyrics found for \*\*${title}\*\*`)
                }
                console.log(`Found lyrics for ${serverQueue.songs[0].title}`);
                let strings = splitText(lyrics);
                let startTime = song.seek ?? 0;
                let currentTime = song.duration - Math.floor((serverQueue.resource.playbackDuration + (startTime*1000))/1000); //calculate remaining time in the song
                //console.log(currentTime)
                for (string of strings) {
                    message.channel.send(string).then(string => setTimeout(() => string.delete(), currentTime*1000));
                }
                //return message.channel.send(lyrics)
            })
            .catch((e) => console.error(e));
}

module.exports = {
    validateRequest, autoplay, seek, play, pause, resume, replay, forward, volume, lyrics
};
