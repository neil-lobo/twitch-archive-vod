require('dotenv').config();
const fetch = require('node-fetch');
const fs = require("fs");
const fse = require('fs-extra');
const path = require('path');
const { exit } = require('process');

let timeoutCounter = 0
const TIMEOUT_LIMIT = 20

function log(str) {
    const date = new Date()
    console.log(`(UTC/GMT${(-1)*date.getTimezoneOffset()/60}) ${date.toLocaleString()} |> ${str}`)
}

function logError(str) {
    const date = new Date()
    console.error(`(UTC/GMT${(-1)*date.getTimezoneOffset()/60}) ${date.toLocaleString()} |> ${str}`)
}

async function isValidToken(token) {
    const res = await fetch("https://id.twitch.tv/oauth2/validate",
        {
            "method": "GET",
            "headers": {
                "Authorization": `OAuth ${token}`
            }
        }
    )
    if (res.status != 200) return false
    const json = await res.json()
    if (json.expires_in < (60*5)) return false // if less than 5 mins left on token
    return true
}

async function generateToken(client_id, client_secret) {
    const res = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials`,
        {
            "method": "POST"
        }
    )
    if (res.status != 200) return null
    return await res.json()
}

function writeTokenFile(token) {
    fs.writeFileSync(".token", token)
}

function readTokenFile() {
    if (fs.existsSync(".token")) {
        const token = fs.readFileSync(".token", {encoding:'utf8'})
        return token
    }
    return null

}

async function getToken() {
    let token = readTokenFile()
    if (token == null) {
        log("Token file not found! Generating new token and writing it to file!")
        token = (await generateToken(process.env.CLIENT_ID, process.env.CLIENT_SECRET)).access_token
        writeTokenFile(token)
        return token
    }
    if (await isValidToken(token)) {
        return token
    } else {
        log("Token invalid! Generating new token and writing to file!")
        token = (await generateToken(process.env.CLIENT_ID, process.env.CLIENT_SECRET)).access_token
        writeTokenFile(token)
        return token
    }
}

async function getStreamers() {
    let streamers = {}
    try {
        const res = await fetch(`${process.env.API_URL}/streamers`)
        if (res.status != 200) {
            logError(`/streamers returned status: ${res.status}`)
            return {}
        }
        
        const data = await res.json()
        for (let key of Object.keys(data)) {
            const streamer = data[key]
            streamers[key] = streamer
        }
    } catch(err) {
        logError(err)
    }
    return streamers
}

async function logVod(data, streamers) {
    let res = await fetch(`${process.env.API_URL}/vod/stream_id/${data.stream_id}`)
    if (res.status != 200) {
        log(`/vod/stream_id/${data.stream_id} Status: ${res.status}`)
        return
    }
    const json = await res.json()
    if (json != null) return

    const thumbnail_url_split = data.thumbnail_url.split("/")
    data["hidden_url"] = {
        "subdomain": thumbnail_url_split[4],
        "path": thumbnail_url_split[5],
    }

    res = await fetch(`${process.env.API_URL}/vods`, {
        "method": "POST",
        "headers": {'Content-Type': 'application/json'},
        "body": JSON.stringify(data)
    })
    if (res.status == 201) log(`Logged new vod: ${streamers[data.user_id]}/${data.stream_id}`)
    else log(`POST /vods Status: ${res.status}`)
}

async function main() {
    if (timeoutCounter >= TIMEOUT_LIMIT) {
        log("TIMEOUT LIMIT REACHED!")
        exit()
    }

    const streamers = await getStreamers()
    const token = await getToken()
    
    for(let id in streamers) {
        const res = await fetch(`https://api.twitch.tv/helix/videos?user_id=${id}&type=archive`,
            {
                "method": "GET",
                "headers": {
                    "Authorization": `Bearer ${token}`,
                    "Client-Id": process.env.CLIENT_ID
                }
            }
        )

        if (res.status != 200) {
            log("Status: " + res.status)
            timeoutCounter++
            continue
        } else {
            timeoutCounter = 0
        }

        const json = await res.json()
        const lastStream = json.data[0]
        if (lastStream.thumbnail_url != "") {
            await logVod(lastStream, streamers)
        }
    }
}

log("[VOD] VOD Logger Started!")
main()
setInterval(main, 1000 * 15)