const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join')
        .setDescription('Summons the bot to your voice channel.'),
    async execute(interaction) {
        const queueConstructor = {
            //textChannel: message.channel,
            connection: null,
            lastPlayed: null, //last played song
            autoplay: false, //if the bot should play related songs
            songs: songs,
            player: null,
            resource: null,
            loop: false,
            //loopall: false,
            //keep: false, //whether or not the current song should be kept in the queue, used for skipping songs while looping
            //timeoutID: undefined    //separate timeout ID for each guild
            volume: 100, //default 100% volume
        };

        queue.set(message.guild.id, queueConstructor);

        //attempt a connection with the user's voice channel, create the audio player
        try {
            let connection = joinVoiceChannel({
                channelId: message.member.voice.channel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
                selfDeaf: false
            })
            queueConstructor.connection = connection;
            queueConstructor.player = createAudioPlayer(
                {
                    behaviors: {
                        noSubscriber: NoSubscriberBehavior.Pause //pause when there is no voice connection
                    },
                }
            );
            //check if bot is moving channels or forcibly disconnected
            connection.once(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                    // Seems to be reconnecting to a new channel - ignore disconnect
                } catch (error) {
                    // Seems to be a real disconnect which SHOULDN'T be recovered from
                    console.log(`Forcibly destroyed the bot.`);
                    connection.destroy();
                    queue.delete(message.guild.id);
                }
            });
            console.log(`Connected to ${message.guild.name}`);
        } catch (err) {
            console.log(err);
            queue.delete(message.guild.id); //on error, trash the serverqueue
            message.channel.send(`\`${err.message}\``)
        }
    },
};