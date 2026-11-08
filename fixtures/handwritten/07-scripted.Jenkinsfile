// Scripted pipeline: not declarative, the tool should say so
node('linux') {
    stage('Build') {
        sh 'make'
    }
    stage('Test') {
        parallel unit: { sh 'make unit' }, e2e: { sh 'make e2e' }
    }
}
