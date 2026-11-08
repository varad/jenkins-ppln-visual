pipeline {
    agent any
    parameters {
        choice(name: 'ENV', choices: ['dev', 'staging', 'prod'], description: 'Target')
        string(name: 'VERSION', defaultValue: '1.0.0')
    }
    triggers { cron('H 2 * * 1-5') }
    stages {
        stage('PR checks') {
            when { changeRequest target: 'main' }
            steps { sh 'make pr-check' }
        }
        stage('Docs only') {
            when { changeset '**/*.md' }
            steps { echo 'docs changed' }
        }
        stage('Nightly') {
            when { triggeredBy 'TimerTrigger' }
            steps { sh 'make nightly' }
        }
        stage('Deploy staging') {
            when {
                beforeAgent true
                anyOf { branch 'main'; branch 'release/*' }
                environment name: 'ENV', value: 'staging'
            }
            steps { sh "deploy --env staging --version ${params.VERSION}" }
        }
        stage('Deploy prod') {
            when {
                allOf {
                    tag pattern: 'v\\d+\\.\\d+\\.\\d+', comparator: 'REGEXP'
                    not { equals expected: 'dev', actual: params.ENV }
                }
            }
            input {
                message 'Deploy to production?'
                ok 'Yes, ship it'
                submitter 'release-managers'
                parameters { string(name: 'REASON', defaultValue: '') }
            }
            steps { sh 'deploy --env prod' }
        }
    }
    post {
        success { slackSend channel: '#ci', message: 'OK' }
        unstable { echo 'unstable' }
        fixed { echo 'fixed again' }
        regression { echo 'regressed' }
        aborted { echo 'aborted' }
        cleanup { cleanWs() }
    }
}
